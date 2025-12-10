import path from "path";

import baseConfig from "../../karma.conf.cjs";

export default function (config) {
  baseConfig(config);

  const storageDir = path.resolve(__dirname, "src/message_channel/storage");

  // Swap node storage for browser storage in webpack builds
  config.webpack.resolve.alias = {
    ...config.webpack.resolve.alias,
    [path.join(storageDir, "node.ts")]: path.join(storageDir, "browser.ts"),
    [path.join(storageDir, "node.js")]: path.join(storageDir, "browser.ts")
  };
}
