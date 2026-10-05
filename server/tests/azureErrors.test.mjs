import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'azure-errors-')), 'test.db');

const { classifyAzureError } = await import('../dist/services/azureErrors.js');
const { scriptRunFailureMessage } = await import('../dist/services/scriptExecution.service.js');

test('uses the inner Run Command code and strips request details', () => {
  const secret = 'super-secret-token';
  const subscription = 'c2840ed5-f09e-460c-abb4-ee1f5cf9381f';
  const err = {
    name: 'RestError',
    statusCode: 409,
    code: 'Conflict',
    message: 'Unexpected status code: 409',
    request: {
      url: `https://management.azure.com/subscriptions/${subscription}/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/JUMP01/runCommand?api-version=2024-07-01`,
      headers: { Authorization: `Bearer ${secret}` },
    },
    details: {
      error: {
        code: 'Conflict',
        message: `See https://management.azure.com/subscriptions/${subscription}/resourceGroups/rg`,
        details: [
          {
            code: 'VMAgentStatusCommunicationError',
            message: `VM 'JUMP01' has not reported status. Bearer ${secret}`,
          },
        ],
      },
    },
  };

  const classified = classifyAzureError(err);
  assert.equal(classified.reason, 'unknown');
  assert.equal(classified.code, 'VMAgentStatusCommunicationError');
  assert.match(classified.message, /VM 'JUMP01' has not reported status/);
  assert.equal(classified.message.includes(secret), false);
  assert.equal(classified.message.includes(subscription), false);
  assert.equal(classified.message.includes('management.azure.com'), false);
  assert.equal(classified.message.includes('Bearer'), false);

  const shown = scriptRunFailureMessage(err);
  assert.match(shown, /Guest Agent is not reporting/);
  assert.match(shown, /VMAgentStatusCommunicationError/);
  assert.equal(shown.includes(secret), false);
});

test('explains a stopped VM from OperationNotAllowed', () => {
  const message = scriptRunFailureMessage({
    statusCode: 409,
    code: 'OperationNotAllowed',
    message: "Operation 'Run Command' is not allowed while the VM is deallocated.",
  });
  assert.match(message, /stopped or deallocated/);
  assert.match(message, /OperationNotAllowed/);
  assert.match(message, /deallocated/);
});

test('keeps a permission failure distinct from a bad credential', () => {
  const denied = classifyAzureError({
    statusCode: 403,
    code: 'AuthorizationFailed',
    message: 'The client does not have authorization to perform action Microsoft.Compute/virtualMachines/runCommand/action.',
  });
  assert.equal(denied.reason, 'auth');
  assert.match(denied.message, /not allowed to perform this action/);
  assert.match(scriptRunFailureMessage({ statusCode: 403, code: 'AuthorizationFailed', message: denied.message }), /runCommand\/action/);

  const badSecret = classifyAzureError({
    name: 'AuthenticationError',
    errorResponse: { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' },
  });
  assert.equal(badSecret.reason, 'auth');
  assert.match(badSecret.message, /check the registered credential/);
  assert.match(badSecret.message, /invalid_client/);
});

test('falls back when Azure gives no usable detail', () => {
  assert.equal(classifyAzureError(new Error('Unexpected status code: 409')).message, 'operation failed for an unexpected reason');
});
