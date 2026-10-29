import { mount } from "svelte";
import "@boardloom/view-dom/styles.css";
import App from "./App.svelte";
import "./styles.css";

const target = document.getElementById("root");
if (target !== null) {
  mount(App, { target });
}
