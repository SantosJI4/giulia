import { EventEmitter } from 'events';
const emitter = new EventEmitter();
export function emitUpdate(phone) { emitter.emit('update', { phone, ts: Date.now() }); }
export function onUpdate(cb) { emitter.on('update', cb); }
