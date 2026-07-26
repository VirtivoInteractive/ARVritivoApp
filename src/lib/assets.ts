export type SplatAsset = {
  id: string;
  name: string;
  manifestUrl: string;
  status: "ready" | "draft";
  detail: string;
  updatedAt: string;
};

export const demoAsset: SplatAsset = {
  id: "skatepark-demo",
  name: "Skatepark study",
  manifestUrl:
    "https://code.playcanvas.com/examples_data/example_skatepark_02/lod-meta.json",
  status: "ready",
  detail: "Official PlayCanvas Streamed SOG sample",
  updatedAt: "Demo asset",
};

export const assets: SplatAsset[] = [demoAsset];