import { createApp } from "vue";
import "./main.css";
import App from "./App.vue";
import "primeicons/primeicons.css"; // 图标
import 'primeflex/primeflex.css'; // PrimeFlex CSS工具类

// 使用PrimeVue
import PrimeVue from 'primevue/config';
import Aura from '@primeuix/themes/aura';

import ToastService from 'primevue/toastservice';
import ConfirmationService from 'primevue/confirmationservice';
import DialogService from 'primevue/dialogservice';

const app = createApp(App);

app.use(PrimeVue, {
    theme: {
        preset: Aura,
        options: {
            prefix: 'p',
            darkModeSelector: 'system',
            cssLayer: false
        }
    }
});
app.use(ToastService);
app.use(ConfirmationService);
app.use(DialogService);

// 挂载应用
app.mount("#app"); 