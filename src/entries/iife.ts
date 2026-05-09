import { mount } from "../core/overlay.ts";

declare global {
  interface Window {
    __ANNOTATOR_ENDPOINT__?: string;
  }
}

mount({ endpoint: window.__ANNOTATOR_ENDPOINT__ });
