// Headless entry: exposes the renderer on window for the CLI / any automation.
import { Renderer } from './renderer';
(window as any).BeatFrame = { Renderer };
