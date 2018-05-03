'use strict';

var util =    require ('util');
var Buffers = require ('buffers');
var _ =       require ('lodash');

var EventEmitter = require('events').EventEmitter;


const RS_INIT =      1;
const RS_HDRS =      2;
const RS_BODY =      3;
const RS_BODY_CL =   4;
const RS_BODY_ZERO = 5;
const RS_TRAIL =     6;


const Commands = {
  CONNECT:     'CONNECT',
  STOMP:       'STOMP',
  CONNECTED:   'CONNECTED',
  SEND:        'SEND',
  SUBSCRIBE:   'SUBSCRIBE',
  UNSUBSCRIBE: 'UNSUBSCRIBE',
  ACK:         'ACK',
  NACK:        'NACK',
  BEGIN:       'BEGIN',
  COMMIT:      'COMMIT',
  ABORT:       'ABORT',
  DISCONNECT:  'DISCONNECT',
  MESSAGE:     'MESSAGE',
  RECEIPT:     'RECEIPT',
  ERROR:       'ERROR'
};


const MandatoryHeaders = {
  CONNECT:     ['accept-version', 'host'],
  STOMP:       ['accept-version', 'host'],
  CONNECTED:   ['version'],
  SEND:        ['destination'],
  SUBSCRIBE:   ['destination', 'id'],
  UNSUBSCRIBE: ['id'],
  ACK:         ['id'],
  NACK:        ['id'],
  BEGIN:       ['transaction'],
  COMMIT:      ['transaction'],
  ABORT:       ['transaction'],
  DISCONNECT:  [],
  MESSAGE:     ['destination', 'message-id', 'subscription'],
  RECEIPT:     ['receipt-id'],
  ERROR:       [],
};


class Frame {
  constructor () {
    this.clear ();
  }

  command (p) {
    if (p) {
      if (!Commands[p]) throw Error ('unrecognized STOMP command ' + p);
      this._cmd = p; 
    }
    else return this._cmd;
  }

  headers (p) {
    if (p) this._headers = p; 
    else return this._headers;
  }

  body (p) {
    if (p) this._body = p; 
    else return this._body;

    // TODO add encoding mgmt
  }

  header (k, v) {
    if (v) this._headers[k] = v; 
    else return this._headers[k];
  }

  ctype (v) {
    if (v) this._headers['content-type'] = v; 
    else return this._headers['content-type'];
  }

  clear () {
    this._cmd = 0;
    this._headers = {};
    this._body = null;
  }

  write (socket, cb) {
    // add calculated headers
    if (this._body) {
      this._headers['content-length'] = Buffer.byteLength (this._body) + '';
    }

    // dump command
    var b = Buffers ();
    b.push (Buffer.from (this._cmd + '\n'));

    _.forEach (this._headers, function (v, k) {
      b.push (Buffer.from (k + ':' + v + '\n'));
    });

    if (this._body) {
      b.push (Buffer.from ('\n' + this._body + '\0'));
    }
    else {
      b.push (Buffer.from ('\n\0'));
    }

    socket.write (b.toBuffer (), cb);
  }
}



class StompSession extends EventEmitter {
  constructor (socket) {
    super ();
    this._s = socket;
    this._clear_state();
    
    this._manage_errors = true;

    var self = this;

    this._s.on ('data', function (data) {
      self._read_buffer.push (data);  
      
      // TODO check a max size is buffered only
      self._incr_parse ();
    });
  }

  manage_errors (v) {
    if (v === true) this._manage_errors = true;
    else if (v === false) this._manage_errors = false;
    else return this._manage_errors;
  }

  ///////////////////////////////
  _read_line () {
    if (this._read_buffer.length <= (this._read_ptr + 1)) {
      // console.log ('empty buffer');
      return null;
    }

    var idx = this._read_buffer.indexOf ('\n', this._read_ptr);
    if (idx == -1) {
      // console.log ('no line left. buffer left is [%s]', this._read_buffer.slice (this._read_ptr));
      return null;
    }

    var line_buf = this._read_buffer.slice (this._read_ptr, idx + 1);
    var line = line_buf.toString ('utf8').trim ();
    // console.log ('read line [%s], old idx %d, new idx %d. %d bytes left in buffer', line, this._read_ptr, idx + 1, this._read_buffer.length - idx - 1);
    this._read_ptr = idx + 1;
    return line;
  }

  ////////////////////////////////////////
  _add_header_line (line) {
    var sep = line.indexOf (':');
    if (sep == -1) return false;
    var k = line.slice (0, sep);
    var v = line.slice (sep + 1);

    // console.log ('added header [%s] -> [%s]', k, v);
    this._in_frame.header (k, v);
    return true;
  }

  ///////////////////////////////////////
  _manage_error (e) {
    this._clear_state ();

    this.emit ('error', e);
    
    if (this._manage_errors) {
      var f = new Frame ();
      f.command (Commands.ERROR);
      f.header ('message', e.message || e);
      f.body (e.message || e);
      f.write (this._s);
      this._s.end ();
    }
  }

  ///////////////////////////////////////
  _clear_state () {
    this._read_buffer = Buffers();
    this._read_ptr = 0;
    this._read_stage = RS_INIT;
    this._in_frame = new Frame ();
  }

  ///////////////////////////////////////
  _semantic_validation () {
    var must_have_headers = MandatoryHeaders[this._in_frame.command()];
    if (!must_have_headers) return null;

    for (var i = 0; i < must_have_headers.length; i++) {
      var h = must_have_headers[i];
      if (_.isUndefined (this._in_frame.header(h))) {
        return util.format ('missing mandatory header [%s] on frame [%s]', h, this._in_frame.command());
      }
    }

    return null;
  }


  ///////////////////////////////////////
  _got_a_frame () {
    var err = this._semantic_validation ();

    if (err) {
      this._manage_error (err);
      return false;
    }

    var rem_buffer = this._read_buffer.slice (this._read_ptr);
    this._read_buffer = Buffers();
    this._read_buffer.push (rem_buffer);
    this._read_ptr = 0;
    this._read_stage = RS_INIT;
    if (this._in_frame.clen) delete this._in_frame.clen;

    this.emit ('frame', this._in_frame);

    this._in_frame = new Frame ();
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
          try {
            this._in_frame.command (line);
            this._read_stage = RS_HDRS;
            //console.log ('cmd read, now moving to RS_HDRS');
          }
          catch (e) {
            // unknown command:
            this._manage_error (e);
          }        
          break;

        case RS_HDRS:
          var line = this._read_line ();
          if (line === null) return;
          if (line.length == 0) {
            // move to read body
            this._read_stage = RS_BODY;
            //console.log ('hdrs read, now moving to RS_BODY');
          }
          else {
            // TODO check header is not malformed
            this._add_header_line (line);
          }
          break;

        case RS_BODY:
          // see if we got content-len or not
          if (this._in_frame.header ('content-length')) {
            this._in_frame.clen = parseInt (this._in_frame.header ('content-length'));
            //console.log ('content-len seen to be %d', this._in_frame.clen);
            this._read_stage = RS_BODY_CL;
          } 
          else {
            this._read_stage = RS_BODY_ZERO;
          }
          break;

        case RS_BODY_CL:
          // console.log ('buffer remaining is %d bytes, need %d', this._read_buffer.length - this._read_ptr, this._in_frame.clen);
          if ((this._read_buffer.length - this._read_ptr) < (this._in_frame.clen + 1)) return;
          this._in_frame.body (this._read_buffer.slice (this._read_ptr, this._in_frame.clen + this._read_ptr).toString ('utf8'));
          
          // reset buffer & ptr
          this._read_ptr = this._in_frame.clen + this._read_ptr + 1;
          this._got_a_frame ();
          break;

        case RS_BODY_ZERO:
          var idx = this._read_buffer.indexOf ('\0', this._read_ptr);
          if (idx < 0) return;

          this._in_frame.body (this._read_buffer.slice (this._read_ptr, idx).toString ('utf8'));

          // reset buffer & ptr
          this._read_ptr = idx + 1;
          this._got_a_frame ();
          break;

        case RS_TRAIL:
          break;
      }
    }
  }
}


module.exports = {
  Frame: Frame,
  StompSession: StompSession
};
