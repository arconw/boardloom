import { provideZonelessChangeDetection } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { AppComponent } from "./app.component.js";
import "./styles.css";

bootstrapApplication(AppComponent, {
  providers: [provideZonelessChangeDetection()],
}).catch((error: unknown) => {
  console.error(error);
});
