import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isStrongPassword } from './password-policy.js'

test('passwords require 12 characters, mixed case, exactly one digit and one symbol', () => {
  assert.equal(isStrongPassword('Abcdefghij1!'), true)
  for (const value of [null, '', 'Abcdefghi1!', 'Abcdefghijk1!', 'abcdefghij1!', 'ABCDEFGHIJ1!', 'Abcdefghijk!', 'Abcdefghijk1', 'Abcdefghi12!', 'Abcdefghi1!!', 'Abcdefgh 1!a']) {
    assert.equal(isStrongPassword(value), false, String(value))
  }
})
