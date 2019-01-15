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

var request = require('request');
var github_app = require('github-app');
var openwhisk = require('openwhisk');
var utils = require('../utils.js');
var config = utils.get_config();
/*
gets fired from github pr creation webhook.
* Check if they are adobe employee, if yes, give checkmark
* If not an employee, report back if the CLA is already signed
* if signed, give checkmark
* if not signed, give an 'x' and tell them to go sign at http://opensource.adobe.com/cla
*/

function main (params) {
  return new Promise((resolve, reject) => {
    if (!params.pull_request || (params.action !== 'opened' && params.action !== 'reopened')) {
      return resolve({
        statusCode: 202,
        body: 'Not a pull request being opened, ignoring payload'
      });
    }

    var ow = openwhisk();
    // TODO: what if the repo is private?
    var github;
    var user = params.pull_request.user.login;
    var start_time = (new Date()).toISOString();
    var org = params.pull_request.base.repo.owner.login;
    var repo = params.pull_request.base.repo.name;
    var commit_sha = params.pull_request.head.sha;
    var installation_id = params.installation.id;

    // base GitHub Check arguments to send
    var base_args = {
      status: 'completed',
      start_time: start_time,
      org: org,
      repo: repo,
      commit_sha: commit_sha,
      installation_id: installation_id
    };

    var app = github_app({
      id: config.githubAppId,
      cert: config.githubKey
    });
    app.asInstallation(installation_id).then(function (gh) {
      github = gh;
      return github.orgs.checkMembership({
        org: org,
        username: user
      });
    }).then(function (is_member) {
      // if status is 204, user is a member.
      // if status is 404, user is not a member - but this triggers the catch in
      // the promise (so we jump to the next chain in the promise).
      // more details here: https://developer.github.com/v3/orgs/members/#check-membership
      if (is_member.status === 204) {
        var all_good_args = Object.assign({
          conclusion: 'success',
          title: '✓ Adobe Employee',
          summary: 'Pull request issued by an Adobe Employee (based on membership in github.com/' + org + '), carry on.'
        }, base_args);
        set_check(ow, all_good_args).then(function (response) {
          resolve(response);
        }).catch(function (err) {
          resolve(respond_with_error(err, 'Error during GitHub Check creation.'));
        });
      }
    }).catch(function (err) {
      if (err.code === 404 && err.message.indexOf('is not a member of the org') > -1) {
        // User is not a member of org, check if they signed CLA
        var options = {
          method: 'POST',
          url: 'https://api.na2.echosign.com/oauth/refresh',
          headers: {
            'cache-control': 'no-cache',
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          form: {
            client_id: config.signClientID,
            client_secret: config.signClientSecret,
            grant_type: 'refresh_token',
            refresh_token: config.signRefreshToken
          }
        };
        // TODO: We're mixing callbacks and promises. Can we replace this with
        // promise? need to use a diff package, request-promise-native or
        // request-promise-any or request-promise
        request(options, function (error, response, body) {
          if (error) {
            return resolve({
              statusCode: 500,
              body: {
                error: error,
                reason: 'Error retrieving Adobe Sign access token.'
              }
            });
          }
          if (response.statusCode !== 200) {
            return resolve({
              statusCode: response.statusCode,
              body: 'Error occured while retrieving access_token for Adobe Sign.'
            });
          }
          var access_token = JSON.parse(body).access_token;
          if (access_token === undefined) {
            return resolve({
              statusCode: response.statusCode,
              body: 'Error occured while retrieving access_token for Adobe Sign.'
            });
          }
          var options = {
            method: 'GET',
            url: 'https://api.na1.echosign.com:443/api/rest/v5/agreements',
            qs: {
              query: user
            },
            headers: {
              'cache-control': 'no-cache',
              'Access-Token': access_token
            },
            json: true
          };
          request(options, function (error, response, body) {
            if (error) {
              return resolve({
                statusCode: 500,
                body: {
                  error: error,
                  reason: 'Error retrieving Adobe Sign agreements.'
                }
              });
            }

            if (!body.userAgreementList || body.userAgreementList.length === 0) {
              sign_cla(ow, base_args).then(function (response) {
                resolve(response);
              }).catch(function (err) {
                resolve(respond_with_error(err, 'Error during sign_cla when body empty.'));
              });
            } else {
              // We have a few agreements to search through.
              var agreements = body.userAgreementList.filter(function (agreement) {
                return (agreement.status === 'SIGNED' && (agreement.name === 'Adobe Contributor License Agreement' || agreement.name === 'Adobe CLA'));
              }).map(function (agreement) {
                return agreement.agreementId;
              });
              ow.actions.invoke({
                name: 'cla-lookup',
                blocking: true,
                result: true,
                params: {
                  agreements: agreements,
                  username: user
                }
              }).catch(function (err) {
                resolve(respond_with_error(err, 'Error invoking lookup action.'));
              }).then(function (res) {
                var usernames = res.body.usernames.map(function (item) { return item.toLowerCase(); });
                if (!usernames.includes(user.toLowerCase())) {
                  sign_cla(ow, base_args).then(function (response) {
                    resolve(response);
                  }).catch(function (err) {
                    resolve(respond_with_error(err, 'Error during sign_cla when username not found.'));
                  });
                } else {
                  var signed_args = Object.assign({
                    conclusion: 'success',
                    title: 'CLA Signed',
                    summary: 'A Signed CLA has been found for the github user ' + user
                  }, base_args);
                  set_check(ow, signed_args).then(function (response) {
                    resolve(response);
                  }).catch(function (err) {
                    resolve(respond_with_error(err, 'Error during GitHub Check creation when CLA username found.'));
                  });
                }
              // TODO: iterate through the agreements, retrieve formdata for
              // each agreement, which is a csv (maybe we could pipe request
              // into a csv parser that can handle streams?), parse the csv,
              // extract data we need.
              // protip: you can see this output from the github app's advanced tab when you dive into the 'deliveries'
              });
            }
          });
        });
      } else {
        return resolve(respond_with_error(err, 'Generic error in checker promise chain.'));
      }
    });
  });
}

function sign_cla (ow, args) {
  var explicit_args = Object.assign({
    conclusion: 'action_required',
    details_url: 'http://opensource.adobe.com/cla.html',
    title: 'Sign the Adobe CLA!',
    summary: 'No signed agreements were found. Please [sign the Adobe CLA](http://opensource.adobe.com/cla.html)! Once signed, close and re-open your pull request to run the check again.\n\n If you are an Adobe employee, you do not have to sign the CLA. Instead contact Adobe\'s Open Source Office about the failure by mentioning them on the pull request with **@adobe/open-source-office** or via email <grp-opensourceoffice@adobe.com>.'
  }, args);
  return set_check(ow, explicit_args);
}

function set_check (ow, args) {
  return ow.actions.invoke({
    name: 'cla-setgithubcheck',
    blocking: true,
    result: true,
    params: args
  }).then(function (check) {
    return {
      statusCode: 200,
      body: check.title
    };
  });
}

function respond_with_error (err, context) {
  return {
    statusCode: 500,
    body: {
      error: err,
      reason: context
    }
  };
}

exports.main = main;
