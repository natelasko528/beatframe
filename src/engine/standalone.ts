// Headless entry: exposes the renderer on window for the CLI / any automation.
import { Renderer } from './renderer';
import { ClipBank } from './clips';
(window as any).BeatFrame = { Renderer, ClipBank };
