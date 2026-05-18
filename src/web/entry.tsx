import { onReconnect, registerServiceWorker } from "pues/base/pwa";
import { createRoot } from "react-dom/client";
import App from "./App";
import { syncMarkdownAfterReconnect } from "./syncMarkdown";
import "pues/base/theme/install";

onReconnect(syncMarkdownAfterReconnect);
registerServiceWorker();

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
