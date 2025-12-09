import { promisify } from "util";

import { publish } from "gh-pages";

/* fix for "Unhandled promise rejections" */
process.on("unhandledRejection", (err) => {
  throw err;
});

const ghpublish = promisify(publish);

const Args = process.argv.slice(2);
const USE_HTTPS = Args[0] && Args[0].toUpperCase() === "HTTPS";

const branch = "gh-pages";
const org = "logos-messaging";
const repo = "logos-messaging-js";
/* use SSH auth by default */
let repoUrl = USE_HTTPS
  ? `https://github.com/${org}/${repo}.git`
  : `git@github.com:${org}/${repo}.git`;

/* alternative auth using GitHub user and API token */
if (typeof process.env.GH_USER !== "undefined") {
  repoUrl =
    "https://" +
    process.env.GH_USER +
    ":" +
    process.env.GH_TOKEN +
    "@" +
    `github.com/${org}/${repo}.git`;
}

const main = async (url, branch) => {
  console.log(`Pushing to: ${url}`);
  console.log(`On branch: ${branch}`);
  await ghpublish("docs", {
    repo: url,
    branch: branch,
    dotfiles: true,
    silent: false
  });
};

void main(repoUrl, branch);
