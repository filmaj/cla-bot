/*
Copyright 2019 Adobe. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/

/*
const request = require('request-promise-native');
*/
const utils = require('../utils.js');
const config = utils.get_config();
const openwhisk = require('openwhisk');
const github_app = require('github-app');

const INSTALLATION_IDS = {
  adobe: 531387,
  AdobeDocs: 574581,
  hubblestack: 840208,
  magento: 1375071
};
const OUR_ORGS = Object.keys(INSTALLATION_IDS);

async function main (params) {
  let progress = '';
  try {
    let headers = {
      'Content-Type': 'application/json'
    };
    if (params && params['__ow_headers'] && (params['__ow_headers']['X-AdobeSign-ClientId'] || params['__ow_headers']['X-ADOBESIGN-CLIENTID'] || params['__ow_headers']['x-adobesign-clientid'])) {
    // This `if` block is the "Verification of intent" from Adobe Sign: https://helpx.adobe.com/sign/using/adobe-sign-webhooks-api.html#VoI
      let client_id = params['__ow_headers']['X-AdobeSign-ClientId'] || params['__ow_headers']['X-ADOBESIGN-CLIENTID'] || params['__ow_headers']['x-adobesign-clientid'];
      if (client_id === config.signClientID) {
      // We are responding to a request from a webhook created by us;
      // Make sure we echo the client id back in the header to ensure Adobe Sign
      // doesn't blacklist us.
        headers['X-AdobeSign-ClientId'] = client_id;
      }
      if (params['__ow_method'] === 'get') {
      // Adobe Sign sends a GET request when we initially register the webhook
      // It normally POSTs notifications of webhook events
      // in the GET case, simply echo back with the client id header to complete
      // the webhook registration
        return {
          statusCode: 200,
          headers,
          body: { ClientIdHeaderStatus: !!headers['X-AdobeSign-ClientId'] }
        };
      }
    }
    progress += '-1';
    if (params.actionType !== 'ESIGNED' || !params.agreement || !params.agreement.id || !params.agreement.name || params.agreement.name !== 'Adobe CLA') {
    // If the needed parameters are not a part of this invocation, ignore.
      return {
        statusCode: 400,
        headers,
        body: 'Insufficient parameters for processing, aborting.'
      };
    }
    progress += '-2';
    const ow = openwhisk();
    let lookup_res;
    try {
      lookup_res = await ow.actions.invoke({
        name: utils.LOOKUP,
        blocking: true,
        result: true,
        params: {
          agreements: params.agreement.id,
          apiVersion: 'v6'
        }
      });
    } catch (e) {
      return {
        statusCode: 500,
        headers,
        body: `Error invoking lookup action when agreements were found: ${e}`
      };
    }
    progress += '-3';
    let usernames = lookup_res.body.usernames;
    if (!usernames) {
      return {
        statusCode: 500,
        headers,
        body: `No usernames were returned from lookup action; maybe an error with lookup action`
      };
    }
    let user_query = usernames.map(u => `author:${u}`).join(' ');
    progress += `-4${user_query}`;
    const app = github_app({
      id: config.githubAppId,
      cert: config.githubKey
    });
    progress += '-5';
    let errors = [];
    let completed = [];
    progress += '-6';
    // for each of our orgs:
    await Promise.all(OUR_ORGS.map(async (org) => {
    // 1. get a github client for each org
      progress += `-7${org}`;
      let installation_id = INSTALLATION_IDS[org];
      let github;
      try {
        github = await app.asInstallation(installation_id);
      } catch (e) {
        errors.push(`Error retrieving GitHub API instance on behalf of app installation for ${org}: ${e}`);
        return;
      }
      progress += `-8${org}`;
      // 2. use each installation's client to use the search api
      // https://developer.github.com/v3/search/#search-issues-and-pull-requests
      // to look for open pull requests from the signed user(s)
      // e.g. is:pr is:open org:adobe author:filmaj
      let search_results;
      try {
        search_results = await github.search.issues({ q: `is:pr is:open org:${org} ${user_query}` });
      } catch (e) {
        errors.push(`Error retrieving GitHub API instance on behalf of app installation for ${org}: ${e}`);
        return;
      }
      progress += `-9${org}`;
      if (search_results.data.total_count) {
      // If there are some PRs open, then we send the org, repo, pr number and
      // head SHA of the PR over to the setgithubcheck action, which will render
      // the green checkmark on the PR!
        await Promise.all(search_results.data.items.map(async (pr) => {
          progress += `-10${org}`;
          let repo_url = pr.repository_url.split('/');
          let repo = repo_url[repo_url.length - 1];
          progress += `-11${org}:${repo}`;
          let pr_data;
          try {
            pr_data = await github.pullRequests.get({
              owner: org,
              repo,
              number: pr.number
            });
          } catch (e) {
            errors.push(`Error retrieving pull request for ${org}/${repo}#${pr.number}: ${e}`);
            return;
          }
          progress += `-12${org}:${repo}`;
          let sha = pr_data.data.head.sha;
          try {
            await ow.actions.invoke({
              name: utils.SETGITHUBCHECK,
              blocking: true,
              result: true,
              params: {
                installation_id: installation_id,
                org: org,
                repo: repo,
                sha,
                status: 'completed',
                conclusion: 'success',
                title: 'CLA Signed',
                summary: 'A Signed CLA has been found for the GitHub.com user ' + pr_data.data.user.login
              }
            });
          } catch (e) {
            errors.push(`Error invoking setgithubcheck for ${org}/${repo}#${pr.number}: ${e}`);
          }
          progress += `-13${org}:${repo}`;
          completed.push(`${org}/${repo}#${pr.number}`);
        }));
      }
    }));
    progress += `-14`;
    return {
      statusCode: 201,
      headers,
      body: errors.length ? errors.join('\n') : `Completed without failure: ${completed.join('\n')}`
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: 'BOOM! we ended up at ' + progress + ' with error: ' + e
    };
  }
}

exports.main = main;
