import http2 from 'http2';

// const options = {
//   key: getKeySomehow(),
//   cert: getCertSomehow()
// };

/**
 * manages our collection of servers
 */

class Http2Manager {
  static _servers: { [key: string]: Http2Server } = {};

  static GetServer(serverName: string): Http2Server {
    if (!this._servers[serverName]) {
      throw new Error('no http2 server found with that name');
    }
    return this._servers[serverName];
  }

  static AddServer(name: string, server: Http2Server): void {
    if (this._servers[name]) {
      throw new Error('an http2 server with that name already exists');
    }
    this._servers[name] = server;
  }

  static async DisconnectAll(): Promise<void> {
    for (const server in this._servers) {
      await this._servers[server].disconnect();
    }
  }
}

/**
 * an individual server
 */

class Http2Server {
  _server: http2.Http2Server = http2.createServer();
  _port: number;
  _streamHandler: (stream: http2.Http2Stream, requestHeaders?: http2.ClientSessionRequestOptions) => void;

  constructor(streamHandler, port: number, key?: string, cert?: string) {
    this._streamHandler = streamHandler;
    this._port = port;
  }

  public connect() {
    this.initStreamHandler();
    this._server.listen(this._port);
  }

  public disconnect() {
    this._server.close();
  }

  private initStreamHandler() {
    this._server.on('stream', this._streamHandler);
  }
}

/**
 * our decorator
 *
 * @param name
 * @param port
 * @param key
 * @param cert
 * @constructor
 */
function Http2(name: string, port: number, key?: string, cert?: string) {
  return function Http2(target, propertyKey, descriptor) {
    const server = new Http2Server(descriptor.value, port, key, cert);
    server.connect();
    Http2Manager.AddServer(name, server);
  };
}

/**
 * Early example
 */

class Example {
  @Http2('an example', 8000)
  thisWillBeAStreamHandler(stream, headers) {
    stream.respond({ ':status': 200, 'content-type': 'text/plain' });
    stream.write('hello ');

    for (let i = 5; i > 0; i--) {
      stream.write('hello ');
    }
  };
}

const example = new Example();
