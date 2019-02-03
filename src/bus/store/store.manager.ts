import { BusStoreApi, BusStore, StoreReadyResult } from '../../store.api';
import { StoreType, UUID } from './store.model';
import { StoreImpl } from './store';
import { EventBus } from '../../bus.api';

/**
 * Copyright(c) VMware Inc. 2016-2018
 */
export class StoreManager implements BusStoreApi {
    
    private internalStoreMap: Map<string, BusStore<any>>;
    
    constructor(private bus: EventBus) {
       
        // Store map.
        this.internalStoreMap = new Map<StoreType, BusStore<any>>();
    }
    
    public createStore<T>(objectType: StoreType, map?: Map<UUID, T>): BusStore<T> {
        if (!this.getStore(objectType)) {
            const cache: BusStore<T> = new StoreImpl<T>(this.bus, objectType);
            if (map) {
                cache.populate(map);
            }
            this.internalStoreMap.set(objectType, cache);
            return cache;
        } else {
            return this.getStore(objectType);
        }
    }

    public getStore<T>(objectType: StoreType): BusStore<T> {
        return this.internalStoreMap.get(objectType);
    }

    public wipeAllStores<T>(): void {
        this.internalStoreMap.clear();
    }

    public destroyStore(objectType: StoreType): boolean {
        if (this.internalStoreMap.has(objectType)) {
            this.internalStoreMap.delete(objectType);
            return true;
        }
        return false;
    }

    public readyJoin(stores: StoreType[]): StoreReadyResult {
       
        return {
            whenReady: (handler: Function) => {
                let storesReady = 0;
                for (let store of stores) {
                    this.createStore(store).whenReady(() => {
                        storesReady++;

                        if (storesReady === stores.length) {
                            handler(Array.from(this.internalStoreMap.values()));
                        }
                    });
                }
            }
        };
    }
}
