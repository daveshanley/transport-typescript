import { ChatMessage } from '../chat-message';
import { AbstractBase } from '@vmw/bifrost/core';
import { ChatOperations } from '@operations/chat.operations';
import { ServbotOperations } from '@operations/servbot.operations';
import { ChatCommand, ServbotResponse } from '../servbot.model';
import { MessageFunction } from '@vmw/bifrost';
import { GeneralError } from '@vmw/bifrost/core/model/error.model';
//import { Mixin } from '@vmw/ngx-utils';
import { Mixin } from '@operations/mixin';
import { BaseTask } from '@vmc/vmc-api';

@Mixin([ChatOperations, ServbotOperations])
export class ChatClientBase extends AbstractBase implements ChatOperations, ServbotOperations {
    createChatMessage: (from: string, avatar: string, body: any) => ChatMessage;
    createControlMessage: (controlEvent: string, error?: boolean, task?: BaseTask) => ChatMessage;
    publishChatMessage: (message: ChatMessage) => void;
    makeServbotRequest: (command: ChatCommand,
                         successHandler: MessageFunction<ServbotResponse>,
                         errorHandler: MessageFunction<GeneralError>) => void;
    listenForServbotOnlineState: (onlineHandler: MessageFunction<boolean>) => void;
    connectServbot: () => void;
}