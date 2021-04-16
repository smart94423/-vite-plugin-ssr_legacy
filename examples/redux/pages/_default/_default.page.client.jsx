import React from "react";
import ReactDOM from "react-dom";
import { Provider } from "react-redux";
import { getPage } from "vite-plugin-ssr/client";
import { getStore } from "./store";

hydrate();

async function hydrate() {
  const { Page, contextProps } = await getPage();
  const store = getStore(contextProps.PRELOADED_STATE);
  ReactDOM.hydrate(
    <Provider store={store}>
      <Page />
    </Provider>,
    document.getElementById("react-root")
  );
}
