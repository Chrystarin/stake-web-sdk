import { createEventEmitter } from 'utils-event-emitter';
import type { EmitterEvent } from './typesEmitterEvent';

export const { eventEmitter } = createEventEmitter<EmitterEvent>();
