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
var github_app = require('github-app');
var utils = require('../utils.js');
var config = utils.get_config();

/*
 * acts as an action that sets github Checks, using the Checks API, on behalf of
 * the CLA bot.
*/

function main (params) {
  return new Promise((resolve, reject) => {
    var installation_id = params.installation_id;
    var app = github_app({
      id: config.githubAppId,
      cert: config.githubKey
    });
    app.asInstallation(installation_id).then(function (github) {
      var options = {
        owner: params.org,
        repo: params.repo,
        name: 'Adobe CLA Signed?',
        head_sha: params.sha,
        status: params.status,
        started_at: params.start_time,
        conclusion: params.conclusion,
        completed_at: (new Date()).toISOString(),
        output: {
          title: params.title,
          summary: params.summary
        }
      };
      if (params.details_url) options.details_url = params.details_url;
      return github.checks.create(options);
    }).then(function (check) {
      resolve({ title: params.title });
    }).catch(function (err) {
      reject(new Error(err));
    });
  });
}

exports.main = main;
