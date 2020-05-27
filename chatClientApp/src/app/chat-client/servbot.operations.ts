/*
 * Copyright 2018 VMware, Inc.
 * SPDX-License-Identifier: BSD-2-Clause
 */
import { EventBus, MessageFunction } from '@vmw/bifrost/bus.api';
import { AbstractCore } from '@vmw/bifrost/core';
import { GeneralError } from '@vmw/bifrost/core/model/error.model';
import { GeneralUtil } from '@vmw/bifrost/util/util';
import { ChatCommand, ServbotResponse } from '../servbot.model';
import { ServbotService } from '@services/servbot/servbot.service';



export class ServbotOperations extends AbstractCore {

    constructor() {
        super();
    }

    public makeServbotRequest(command: ChatCommand,
                              successHandler: MessageFunction<ServbotResponse>,
                              errorHandler: MessageFunction<GeneralError>): void {

        this.bus.requestOnceWithId(
            GeneralUtil.genUUID(),
            'servbot-query',
            {command: command},
            'servbot-query',
            EventBus.id
        ).handle(
            (resp: ServbotResponse) => {
                successHandler(resp);
            },
            (error: GeneralError) => {
                errorHandler(error);
            }
        );
    }

    public listenForServbotOnlineState(onlineHandler: MessageFunction<boolean>): void {
        this.bus.listenOnce(ServbotService.onlineChannel).
        handle(
            (online: boolean) => {
                onlineHandler(online);
            }
        );
    }

    public connectServbot(): void {
        this.bus.sendRequestMessage(ServbotService.queryChannel, {command: ChatCommand.Connect}, EventBus.id);
    }

}
