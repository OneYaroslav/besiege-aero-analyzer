import "i18next";
import type analysis from "../locales/en/analysis.json";
import type common from "../locales/en/common.json";
import type plotlab from "../locales/en/plotlab.json";
import type snapshots from "../locales/en/snapshots.json";
import type tutorial from "../locales/en/tutorial.json";
import type viewer3d from "../locales/en/viewer3d.json";
import type whatif from "../locales/en/whatif.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: {
      common: typeof common;
      analysis: typeof analysis;
      plotlab: typeof plotlab;
      whatif: typeof whatif;
      snapshots: typeof snapshots;
      viewer3d: typeof viewer3d;
      tutorial: typeof tutorial;
    };
  }
}
