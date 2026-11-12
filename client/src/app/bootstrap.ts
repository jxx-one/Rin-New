import i18n from "i18next";
import Backend from "i18next-http-backend";
import { initReactI18next } from "react-i18next";
import { listenSystemMode } from "../utils/darkModeUtils";

const SUPPORTED_LANGUAGES = ["en", "zh-CN", "zh-TW", "ja"];

function getInitialLanguage() {
  try {
    const saved = window.localStorage.getItem("rin-language");
    if (saved && SUPPORTED_LANGUAGES.includes(saved)) {
      return saved;
    }
  } catch {
    // 隐私模式下读不到 localStorage 时直接用默认语言。
  }
  return "zh-CN";
}

let bootstrapped = false;

export async function bootstrapApp() {
  if (bootstrapped) {
    return;
  }

  listenSystemMode();

  await i18n
    .use(Backend)
    .use(initReactI18next)
    .init({
      backend: {
        loadPath: "/locales/{{lng}}/{{ns}}.json",
      },
      // 显式指定初始语言，不完全跟随浏览器语言；只有用户主动切换过才使用其选择。
      // 这样中文后台不会因为浏览器语言或竞态偶尔回退成英文/原始 key。
      lng: getInitialLanguage(),
      supportedLngs: SUPPORTED_LANGUAGES,
      fallbackLng: "zh-CN",
      interpolation: {
        escapeValue: false,
      },
    });

  bootstrapped = true;
}
