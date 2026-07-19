// Aggregator for the en (fallback) shared locale — one named export per namespace file.
// This is a file (not a folder index) because the package's `./*` exports map has no
// directory-index resolution.
export { default as auth } from './en/auth';
export { default as board } from './en/board';
export { default as chat } from './en/chat';
export { default as common } from './en/common';
export { default as difficulty } from './en/difficulty';
export { default as errors } from './en/errors';
export { default as events } from './en/events';
export { default as eventsMode } from './en/eventsMode';
export { default as game } from './en/game';
export { default as gameSettings } from './en/gameSettings';
export { default as history } from './en/history';
export { default as home } from './en/home';
export { default as log } from './en/log';
export { default as report } from './en/report';
export { default as room } from './en/room';
export { default as settings } from './en/settings';
export { default as tutorial } from './en/tutorial';
