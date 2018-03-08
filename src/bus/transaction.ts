import { UUID, StoreType } from './store/store.model';
import { MessageFunction, Message } from './model/message.model';
import { BusTransaction, TransactionReceipt, TransactionType, EventBus, ChannelName } from './bus.api';
import { TransactionRequest, TransactionRequestImpl, TransactionReceiptImpl } from './model/transaction.model';
import { StompParser } from '../index';
import { LoggerService } from '../log/index';
import { MessageBusEnabled } from './messagebus.service';
import { Syslog } from '../log/syslog';
import { Observable } from 'rxjs/Observable';
import { Subject } from 'rxjs/Subject';
import { GeneralUtil } from '../util/util';

/**
 * Copyright(c) VMware Inc. 2016-2018
 */

export class BusTransactionImpl implements BusTransaction {
    
    private requests: Array<TransactionRequest>;
    private transactionType: TransactionType;
    private transactionReceipt: TransactionReceipt;
    private transactionSession: any;
    private bus: EventBus;
    private name: string;
    private completedHandler: any;
    private log: LoggerService;
    private id: UUID;
    private transactionErrorChannel: ChannelName;
    private completed: boolean = false;
    private transactionCompleteError: Error =  null;
    private syncStream: Subject<TransactionRequest>;

    constructor(
            bus: EventBus,
            logger: LoggerService, 
            transactionType: TransactionType = TransactionType.ASYNC,
            name: string = 'BusTransaction'
        ) {
        this.bus = bus;
        this.log = logger;
        this.transactionType = transactionType;
        this.requests = [];
        this.name = name;
        this.id = StompParser.genUUID();
        this.transactionErrorChannel = 'transaction-' + this.id + '-errors';
        this.log.info('🏦 Transaction Created', this.transactionName());
    }

    public waitForStoreReady(store: StoreType): void {
        if (this.completed) {
            this.transactionCompletedMessage('cannot queue a new cache initialization via waitForCacheReady()');
            throw this.transactionCompleteError;
        }
        const req: TransactionRequest = new TransactionRequestImpl(null, null, store);
        this.requests.push(req);
        this.log.info('⏳ Transaction [' + this.id + '] Store Ready Request Queued: [' + req.id + ']', this.name);
    }

    //private requests
    public sendRequest<Req>(channel: string, payload: Req): void {
      
        if (this.completed) {
            this.transactionCompletedMessage('cannot queue a new request via sendRequest()');
            throw this.transactionCompleteError;
        }
        const req: TransactionRequest = new TransactionRequestImpl<Req>(channel, payload);
        this.requests.push(req);
        this.log.info('⏳ Transaction [' + this.id + '] Request Queued: [' + req.id + ']', this.name);
    }
    public onComplete<Resp>(completeHandler: MessageFunction<Resp[]>): void {
       
        if (this.completed) {
            this.transactionCompletedMessage('cannot register onComplete() handler');
            throw this.transactionCompleteError;
        }
        this.log.info('👋 Transaction Complete Handler Registered', this.transactionName());
        this.completedHandler = completeHandler;
    }

    public commit(): TransactionReceipt {
       
        if (this.completed) {
            this.transactionCompletedMessage('cannot re-commit transaction via commit()');
            throw this.transactionCompleteError;
        }
        
        if (this.requests.length <= 0) {
            throw new Error('Transaction cannot be committed, no requests made.');
        }
        
        this.transactionReceipt = new TransactionReceiptImpl(this.requests.length, this.id);
        switch (this.transactionType) {

            case TransactionType.ASYNC:
                this.startAsyncTransaction();
                break;
            
            case TransactionType.SYNC:
                this.startSyncTransaction();
                break;
            
            default:
                break;
        }

        return this.transactionReceipt;
    }

    public onError<T>(errorHandler: MessageFunction<T>): void {
        if (this.completed) {
            this.transactionCompletedMessage('cannot register new error handler via onError()');
            throw this.transactionCompleteError;
        }
        this.bus.listenOnce(this.transactionErrorChannel)
            .handle(
                (error: any) => {
                    this.log.error('Transaction [' + this.id + ']', error);
                    errorHandler(error);
                }
            );
    }

    private sendRequestAndListen(request: TransactionRequest, responseHandler: Function, type: TransactionType) {
       
        this.log.info('➡️ ' + type + ' Sending Request Transaction to channel: ' 
                        + request.channel, this.transactionName());

        const mId = StompParser.genUUID(); // use message ID's to make sure we only react to each explicit response
        const handler = this.bus.listenStream(request.channel, this.name, mId);
        handler.handle(
            (response: any) => {
                this.log.info('⬅️ ' + type + ' Transaction Response on channel: ' 
                                + request.channel + ' - ' + response, this.transactionName());
                responseHandler(response);
                handler.close();
            }, 
            (error: any) => {
                
                // send to onError handler.
                this.bus.sendResponseMessageWithId(this.transactionErrorChannel, error, mId);
            }
        ); 
        this.bus.sendRequestMessageWithId(request.channel, request.payload, mId);
    }

    private transactionCompleteHandler(responses: Array<any>) {
        this.transactionReceipt.complete = true;
        this.transactionReceipt.completedTime = new Date();
        this.transactionCompleted();
        this.completedHandler(responses);
    }

    private startAsyncTransaction(): void {
     
        this.log.info('🎬 Starting Async Transaction', this.transactionName());
        let responses = new Array<any>();
        const requestList: Array<TransactionRequest> = this.requests.slice();
        let counter: number = 0;
        
        // create async response handler for requests/responses.
        const responseHandler = (response: any) => {
            counter++;
            responses.push(response);
            this.transactionReceipt.requestsCompleted++;
            if (counter >= this.requests.length) {
                this.transactionCompleteHandler(responses);
                return;
            }
        };

        // create async response handler for stores
        const storeHandler = (response: Map<UUID, any>) => {
            counter++;
            responses.push(response);
            this.transactionReceipt.requestsCompleted++;
            if (counter >= this.requests.length) {
                this.transactionCompleteHandler(responses);
                return;
            }
        };

        // started transaction
        this.transactionReceipt.startedTime = new Date();
        
        requestList.forEach(
            (request: TransactionRequest) => {
                this.transactionReceipt.requestsSent++;  
                if (!request.store) {
                    this.sendRequestAndListen(request, responseHandler, TransactionType.ASYNC);
                } else {
                    this.log.info('⏱️ Waiting for Store to be ready: ' + request.store, this.transactionName());
                    this.bus.stores.createStore(request.store).whenReady(storeHandler);
                }
            }
        );

    }

    private transactionName(): string {
        return this.name + '.' + this.id;
    }

    private startSyncTransaction(): void {
        this.syncStream = new Subject<TransactionRequest>();
        
        this.log.info('🎬 Starting Sync Transaction', this.transactionName());
        let responses = new Array<any>();
        const requestList: Array<TransactionRequest> = this.requests.slice();
        let counter: number = 0;
        
        const requestStream: Observable<TransactionRequest[]> = Observable.of(requestList);
        for (let x = 0; x < requestList.length; x++) {
            if (x >= 0 && x < requestList.length ) {
                requestList[x].nextRequest = requestList[x + 1];
            }
        }
        
        this.syncStream.subscribe(
            (req: TransactionRequest) => {
                const responseHandler = (response: any) => {
                    counter++;
                    responses.push(response);
                    this.transactionReceipt.requestsCompleted++;
                    if (req.nextRequest) {
                        this.syncStream.next(req.nextRequest);
                    }
                    if (counter >= this.requests.length) {
                        this.syncStream.complete();
                    }
                };
                this.sendRequestAndListen(req, responseHandler, TransactionType.SYNC);
                this.transactionReceipt.requestsSent++;
            }, 
            (error) => {
                    // send to onError handler.
                    this.bus.sendResponseMessage(this.transactionErrorChannel, error);
            },
            () => {
                this.transactionCompleteHandler(responses);
            }
        );
        
        this.syncStream.next(requestList[0]);
    }

    private transactionCompleted(): void {
        this.completed = true;
        this.transactionCompleteError = new Error('transaction ' + this.id + ' has already completed');
        this.log.info('🎉 Transaction Completed', this.transactionName());
    }

    private transactionCompletedMessage(msg: string): void {
        this.log.warn('Transaction Complete: ' + msg, this.transactionName());
    }
 }