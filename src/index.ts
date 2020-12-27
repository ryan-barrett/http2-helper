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

  static Get(serverName: string): Http2Server {
    if (!this._servers[serverName]) {
      throw new Error('no http2 server found with that name');
    }
    return this._servers[serverName];
  }

  static Add(name: string, server: Http2Server): void {
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
  _streamHandler: (stream: http2.Http2Stream, requestHeaders?: http2.ClientSessionRequestOptions) => void;

  constructor(streamHandler, key?: string, cert?: string) {
    this._streamHandler = streamHandler;
  }

  public connect() {
    this.initStreamHandler();
    this._server.listen(8000);
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
 * @param key
 * @param cert
 * @constructor
 */
function Http2(name: string, key?: string, cert?: string) {
  return function Http2(target, propertyKey, descriptor) {
    const server = new Http2Server(descriptor.value, key, cert);
    server.connect();
    Http2Manager.Add(name, server);
  };
}

/**
 * Early example
 */

class Example {
  @Http2('an example')
  thisWillBeAStreamHandler(stream, headers) {
    stream.respond({ ':status': 200, 'content-type': 'text/plain' });
    stream.write('hello ');

    for (let i = 5; i > 0; i--) {
      stream.write('hello ');
    }
  };
}

const example = new Example();
