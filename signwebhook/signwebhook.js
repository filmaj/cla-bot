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

async function main (params) {
  let headers = {
    'Content-Type': 'application/json'
  };
  if (params && params['__ow_headers'] && (params['__ow_headers']['X-AdobeSign-ClientId'] || params['__ow_headers']['X-ADOBESIGN-CLIENTID'])) {
    // Verification of intent from Adobe Sign: https://helpx.adobe.com/sign/using/adobe-sign-webhooks-api.html#VoI
    let client_id = params['__ow_headers']['X-AdobeSign-ClientId'] || params['__ow_headers']['X-ADOBESIGN-CLIENTID'];
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
        statusCode: 204,
        headers,
        body: { ClientIdHeaderStatus: !!headers['X-AdobeSign-ClientId'] }
      };
    }
  }
  // Just echo out what we received from the webhook payload for now
  return {
    statusCode: 200,
    headers,
    body: params
  };
  /*
  // Get an access_token from a refresh_token for Adobe Sign APIs
  let response;
  try {
    response = await utils.get_adobe_sign_access_token(config);
  } catch (e) {
    return utils.action_error(e, 'Error during retrieval of Adobe Sign access token.');
  }
  const access_token = response.access_token;
  if (!access_token) {
    return { statusCode: 500, body: 'Empty access_token retrieved from Adobe Sign.' };
  */
}

exports.main = main;
