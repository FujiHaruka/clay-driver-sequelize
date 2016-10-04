/**
 * Test case for sequelizeDriver.
 * Runs with mocha.
 */
'use strict'

const SequelizeDriver = require('../lib/sequelize_driver.js')
const assert = require('assert')
const rimraf = require('rimraf')
const co = require('co')

describe('sequelize-driver', function () {
  this.timeout(3000)

  before(() => co(function * () {

  }))

  after(() => co(function * () {

  }))

  it('Sequelize driver', () => co(function * () {
    rimraf.sync(`${__dirname}/../tmp/testing-db-01.db`)
    let driver = new SequelizeDriver()
    yield driver.connect({
      dialect: 'sqlite',
      storage: `${__dirname}/../tmp/testing-db-01.db`
    })
    yield driver.create('/foo/bar/baz', {
      key: 'baz',
      value: { hoge: 'This is hoge' },
      at: new Date()
    })
    {
      let baz = yield driver.read('/foo/bar/baz')
      assert.deepEqual(baz.value, { hoge: 'This is hoge' })
    }
    yield driver.update('/foo/bar/baz', {
      value: { hoge: 'This is hoge2' }
    })
    {
      let baz = yield driver.read('/foo/bar/baz')
      assert.deepEqual(baz.value, { hoge: 'This is hoge2' })
    }
    yield driver.delete('/foo/bar/baz')
    yield driver.disconnect()
  }))
})

/* global describe, before, after, it */