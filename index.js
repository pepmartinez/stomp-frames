'use strict';

var net = require('net');
var Buffers = require ('buffers');


const RS_INIT =      1;
const RS_HDRS =      2;
const RS_BODY =      3;
const RS_BODY_CL =   4;
const RS_BODY_ZERO = 5;
const RS_TRAIL =     6;


const commands = {
  CONNECT:     1,
  STOMP:       2,
  CONNECTED:   3,
  SEND:        4,
  SUBSCRIBE:   5,
  UNSUBSCRIBE: 6,
  ACK:         7,
  NACK: 8,
  BEGIN: 9,
  COMMIT: 10,
  ABORT: 11,
  DISCONNECT: 12,
  MESSAGE: 13,
  RECEIPT: 14,
  ERROR: 15
};

class StompServerSession {
  constructor (socket) {
    this._s = socket;

    this._read_stage = RS_INIT;
    this._read_ptr = 0;
    this._read_buffer = Buffers();

    this._in_frame = {
      cmd: null,
      hdrs: {},
      body: null
    }

    var self = this;

    this._s.on('end',     function ()    {self._socket_end ()});
    this._s.on('close',   function ()    {self._socket_close ()});
    this._s.on('error',   function (err) {self._socket_error (err)});
    this._s.on('timeout', function ()    {self._socket_timeout ();});

    this._s.on ('data', function (data) {
console.log (data)
      self._read_buffer.push (data);  
      
      // TODO check a max size is buffered only
      self._incr_parse ();
    });
  }

  ///////////////////////////////
  _read_line () {
    if (this._read_buffer.length <= (this._read_ptr + 1)) {
console.log ('empty buffer');
      return null;
    }

    var idx = this._read_buffer.indexOf ('\n', this._read_ptr);
    if (idx == -1) {
console.log ('no line left. buffer left is [%s]', this._read_buffer.slice (this._read_ptr));
      return null;
    }

    var line_buf = this._read_buffer.slice (this._read_ptr, idx + 1);
    var line = line_buf.toString ('utf8').trim ();
//console.log ('read line [%s], old idx %d, new idx %d. %d bytes left in buffer', line, this._read_ptr, idx + 1, this._read_buffer.length - idx - 1);
//console.log (line_buf)
    this._read_ptr = idx + 1;
    return line;
  }

  ////////////////////////////////////////
  _add_header_line (line) {
    var sep = line.indexOf (':');
    if (sep == -1) return false;
    var k = line.slice (0, sep).trim ().toLowerCase();
    var v = line.slice (sep + 1).trim ();

    console.log ('added header [%s] -> [%s]', k, v);
    this._in_frame.hdrs[k] = v;
    return true;
  }

  ///////////////////////////////////////
  _incr_parse () {
    for (;;) {
      switch (this._read_stage) {
        case RS_INIT:
          var line = this._read_line ();
          if (line === null) return;  // not enough data
          if (line.length == 0) break; // empty lines before frame

          // TODO check command is valid & known
          this._in_frame.cmd = line;
          this._read_stage = RS_HDRS;
console.log ('cmd read, now moving to RS_HDRS');        
          break;

        case RS_HDRS:
          var line = this._read_line ();
          if (line === null) return;
          if (line.length == 0) {
            // move to read body
            this._read_stage = RS_BODY;
console.log ('hdrs read, now moving to RS_BODY');
          }
          else {
            // TODO check header is not malformed
            this._add_header_line (line);
          }
          break;

        case RS_BODY:
          // see if we got content-len or not
          if (this._in_frame.hdrs ['content-length']) {
            this._in_frame.clen = parseInt (this._in_frame.hdrs ['content-length']);
console.log ('content-len seen to be %d', this._in_frame.clen);
            this._read_stage = RS_BODY_CL;
          } 
          else {
            this._read_stage = RS_BODY_ZERO;
          }
          break;

        case RS_BODY_CL:
          break;

        case RS_BODY_ZERO:
          var idx = this._read_buffer.indexOf ('\0', this._read_ptr);
          if (idx < 0) return;

          this._in_frame.body = this._read_buffer.slice (this._read_ptr, idx).toString ('utf8').trim ();

          // reset buffer & ptr
//          var new_buffs = Buffers ();

//          if (this._read_buffer.length)


          var rem_buffer = this._read_buffer.slice (idx + 1);
          this._read_buffer = Buffers();
          this._read_buffer.push (rem_buffer);
          this._read_ptr = 0;
          this._read_stage = RS_INIT;

console.log ('frame', this._in_frame)          
          break;

        case RS_TRAIL:
          break;
      }
    }
  }

  _socket_end () {
    console.log ('connection ended');
  }

  _socket_close () {
    console.log ('connection severed');
  }

  _socket_error (err) {
    console.log ('connection error:', err);
  }

  _socket_timeout () {
    console.log ('connection idle for too long', err);
  }
}


var server = net.createServer(function(socket) {
  console.log ('connection established');
  new StompServerSession(socket);
});

server.listen(1337);







var client = new net.Socket();
client.connect(1337, '127.0.0.1', function() {
	console.log('CL Connected');
  client.write(
`

COMMD
x-aaa: 666
x-g: trytyt
CotE  :  to

data dta
gwgwegrwe
gewggwer
gwer
e
we
rwe
yewry
` + '\0\r\n\r\n');

client.on('data', function(data) {
	console.log('CL Received: ' + data);
	client.destroy(); // kill client after server's response
});

client.on('end', function() {
	console.log('CL Connection end');
});

client.on('close', function() {
	console.log('CL Connection closed');
});

});

