import "@fontsource-variable/inter";
import { createApp } from "vue";
import App from "./App.vue";
import { adoptToken } from "./api";
import "./theme.css";

adoptToken(); // before mount, so the first render already knows its key
createApp(App).mount("#app");
