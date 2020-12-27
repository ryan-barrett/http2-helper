import http2            from 'http2';
import { EventEmitter } from 'events';

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
  public name: string;
  protected _server: http2.Http2Server = http2.createServer();
  protected _port: number;
  public emitter: EventEmitter = new EventEmitter();

  constructor(name: string, port: number, key?: string, cert?: string) {
    this.name = name;
    this._port = port;
    Http2Manager.AddServer(name, this);
  }

  public connect() {
    this.initStreamEmitter();
    this._server.listen(this._port);
  }

  public disconnect() {
    this._server.close();
  }

  private initStreamEmitter() {
    this._server.on('stream', (stream, headers) => {
      stream.respond({ ':status': 200, 'content-type': 'text/plain' });
      this.emitter.emit(`${this.name}:Http2Stream`, stream, headers);
    });
  }
}

/**
 * things we assume happen elsewhere for now
 */

const server = new Http2Server('test', 8000);
server.connect();

/**
 * our decorator
 *
 * @constructor
 * @param serverName
 */
function Http2(serverName: string) {
  return function Http2(target, propertyKey, descriptor) {
    const server = Http2Manager.GetServer(serverName);
    server.emitter.on(`${serverName}:Http2Stream`, function (stream: http2.Http2Stream, headers: http2.ClientSessionRequestOptions) {
      descriptor.value(stream, headers);
    });
  };
}

/**
 * Early example - this method will execute when a connection is made
 */

class Example {
  @Http2('test')
  public thisWillBeAStreamHandler(stream, headers) {
    stream.write('hello ');

    for (let i = 5; i > 0; i--) {
      stream.write('hello ');
    }
  };

  anotherNonHttp2Method() {
    console.log('things are happening');
  }
}

/**
 * another class that also listens to incoming streams and takes action on them. In this case it just logs our headers
 */

class Example2 {
  @Http2('test')
  public anotherStreamHandler(stream, headers) {
    console.log('headers', headers);
  }

  @Http2('test')
  public sendSomeMessage(stream, headers) {
    setTimeout(() => {
      stream.write('hello again');
    }, 5000);
  }
}

const example = new Example();
const example2 = new Example2();

example.anotherNonHttp2Method();
