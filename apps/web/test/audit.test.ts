import assert from 'node:assert/strict';
import {test} from 'node:test';
import {auditActionLabel, auditDetails} from '../lib/audit';

test('audit details render only bounded known fields', () => {
  assert.deepEqual(auditDetails({action: 'CHANGE_ROLE', details: JSON.stringify({role: 'FACULTY', unexpected: '<script>secret</script>'})}), ['New role: Faculty']);
  assert.deepEqual(auditDetails({action: 'MODERATE_PROJECT', details: JSON.stringify({status: 'APPROVED', expectedVersion: 7})}), ['Decision: Approved', 'Reviewed version: 7']);
  const feedback = auditDetails({action: 'MODERATE_PROJECT', details: JSON.stringify({feedback: 'x'.repeat(1000)})})[0];
  assert.equal(feedback.length, 'Feedback: '.length + 501);
});

test('legacy, invalid, oversized and prototype-shaped audit details remain inert', () => {
  assert.deepEqual(auditDetails({action: 'CHANGE_ROLE', details: '{bad'}), ['Details are unavailable.']);
  assert.deepEqual(auditDetails({action: 'CHANGE_ROLE', details: JSON.stringify({role: '__proto__'})}), ['Role details are unavailable.']);
  assert.deepEqual(auditDetails({action: 'LEGACY', details: '{"private":"hidden"}'}), ['No structured details are available for this action.']);
  assert.deepEqual(auditDetails({action: 'CHANGE_ROLE', details: 'x'.repeat(8001)}), ['Details are too long to display.']);
  assert.equal(auditActionLabel('x'.repeat(100)).length, 81);
});
