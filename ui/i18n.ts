import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import analysis from "../locales/en/analysis.json";
import common from "../locales/en/common.json";
import plotlab from "../locales/en/plotlab.json";
import snapshots from "../locales/en/snapshots.json";
import tutorial from "../locales/en/tutorial.json";
import viewer3d from "../locales/en/viewer3d.json";
import whatif from "../locales/en/whatif.json";
import analysisRu from "../locales/ru/analysis.json";
import commonRu from "../locales/ru/common.json";
import plotlabRu from "../locales/ru/plotlab.json";
import snapshotsRu from "../locales/ru/snapshots.json";
import tutorialRu from "../locales/ru/tutorial.json";
import viewer3dRu from "../locales/ru/viewer3d.json";
import whatifRu from "../locales/ru/whatif.json";

export const DEFAULT_LANGUAGE = "en";
export const UI_LANGUAGE_STORAGE_KEY = "besiege-aero-analyzer.language";
export const SUPPORTED_LANGUAGES = ["en", "ru"] as const;
export const I18N_NAMESPACES = [
  "common",
  "analysis",
  "plotlab",
  "whatif",
  "snapshots",
  "viewer3d",
  "tutorial",
] as const;

export type UiNamespace = (typeof I18N_NAMESPACES)[number];

export const i18nResources = {
  en: {
    common,
    analysis,
    plotlab,
    whatif,
    snapshots,
    viewer3d,
    tutorial,
  },
  ru: {
    common: commonRu,
    analysis: analysisRu,
    plotlab: plotlabRu,
    whatif: whatifRu,
    snapshots: snapshotsRu,
    viewer3d: viewer3dRu,
    tutorial: tutorialRu,
  },
} as const;

function storedLanguage(): (typeof SUPPORTED_LANGUAGES)[number] {
  if (typeof localStorage === "undefined") return DEFAULT_LANGUAGE;
  const value = localStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
  return value === "ru" ? "ru" : DEFAULT_LANGUAGE;
}

export const i18nReady = i18n
  .use(initReactI18next)
  .init({
    resources: i18nResources,
    lng: storedLanguage(),
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGES,
    defaultNS: "common",
    fallbackNS: "common",
    ns: I18N_NAMESPACES,
    load: "languageOnly",
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });

export async function setUiLanguage(language: string): Promise<void> {
  const supported = language === "ru" ? "ru" : DEFAULT_LANGUAGE;
  if (typeof localStorage !== "undefined") localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, supported);
  await i18n.changeLanguage(supported);
}

export default i18n;
