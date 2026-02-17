/* eslint-disable no-var */
import { SocketGateway } from '../websocket/socket.gateway';

declare global {
    var socketGateway: SocketGateway | undefined;
}

export { }; // This file needs to be a module
