/**
 * Define entity model
 * @function entityModel
 * @param {function} define - Definer
 * @returns {Object} Defined model
 */
'use strict'

const { STRING, TEXT } = require('sequelize')
const { parseFilter, parseSort } = require('../helpers/parser')
const { get, set } = require('../helpers/attribute_access')
const { expand } = require('objnest')
const LRU = require('lru-cache')
const { deserialize } = require('../helpers/serializer')
const ARRAY_LAST_INDEX_PATTERN = /(.*)(\[)([0-9]+)(\])$/
const { ENTITY_SUFFIX, OVERFLOW_SUFFIX, ID_SUFFIX } = require('../constants/model_keywords')

const { DataTypes } = require('clay-constants')

const DataTypesArray = Object.keys(DataTypes).map((name) => DataTypes[ name ])

const attributeValuesWith = (attributes) =>
  [
    ...attributes.reduce((attributes, { col }) => [ ...attributes, `t${col}`, `v${col}` ], []),
    'id',
    'cid',
    'createdAt',
    'updatedAt'
  ]

/** @lends entityModel */
function entityModel ({
                        db,
                        resourceName,
                        valueBaseLength = 255,
                        prefix = '',
                        numberOfCols = 64
                      }) {
  const modelName = prefix + ENTITY_SUFFIX
  const modelIdName = modelName + ID_SUFFIX
  const extraRefName = 'Extras'
  const Entity = db.define(modelName, Object.assign(
    {
      cid: {
        comment: 'Clay id',
        type: STRING,
        allowNull: false,
        unique: true
      }
    },
    ...new Array(numberOfCols).fill(null)
      .map((_, col) => ({
        [`t${col}`]: {
          comment: `Type for ${col}`,
          type: STRING(2),
          allowNull: true
        },
        [`v${col}`]: {
          comment: `Value for ${col}`,
          type: STRING(valueBaseLength),
          allowNull: true
        }
      }))
  ), {
    freezeTableName: true,
    instanceMethods: {
      valueFor (col, { extras } = {}) {
        const s = this
        const valueName = `v${col}`
        const typeName = `t${col}`
        const type = DataTypesArray[ s[ typeName ] ]
        const extra = extras[ valueName ]
        const value = extra ? extra + s[ valueName ] : s[ valueName ]
        if (!type) {
          return value
        }
        return deserialize(value, type)
      },
      asClay (attributes) {
        const s = this
        const extras = Object.assign(
          {},
          ...(s[ extraRefName ] || [])
            .filter(({ value }) => !!value)
            .map(({ name, value }) => ({
              [name]: value
            }))
        )
        const values = attributes.reduce((attributeValues, attribute) => {
          const { name, col } = attribute
          const isArray = ARRAY_LAST_INDEX_PATTERN.test(name)
          const value = s.valueFor(col, { extras })

          if (isArray) {
            const [ , arrayName, , index ] = name.match(ARRAY_LAST_INDEX_PATTERN)
            const array = get(attributeValues, arrayName) || []
            array[ Number(index) ] = value
            set(attributeValues, arrayName, array)
            return attributeValues
          } else {
            return Object.assign(attributeValues, { [name]: value })
          }
        }, {
          id: s.cid,
          $$at: s.updatedAt,
          $$as: resourceName
        })
        return expand(values)
      },
      async createExtra (extraValues) {
        const s = this
        const extraNames = Object.keys(extraValues)
          .filter((name) => !!extraValues[ name ])
        if (extraNames.length === 0) {
          return
        }
        await Entity.Extra.bulkCreate(
          extraNames.map((name) => ({
            name,
            value: extraValues[ name ],
            [modelIdName]: s.id
          }))
        )
      },
      async updateExtra (extraValues) {
        const s = this
        const extraNames = Object.keys(extraValues)
        if (extraNames.length === 0) {
          return
        }
        for (const name of extraNames) {
          await Entity.Extra.upsert({
            name,
            value: extraValues[ name ],
            [modelIdName]: s.id
          })
        }
      }
    },
    classMethods: {
      valuesWithCols (cols) {
        if (cols.length > numberOfCols) {
          throw new Error(`[ClayDriverSequelize] Too many cols for resource: "${resourceName}"`)
        }
        const extra = {}
        const base = Object.assign(
          {},
          ...cols.map(({ col, type, value }) => {
            const typeKey = `t${col}`
            const valueKey = `v${col}`
            if (value && value.length > valueBaseLength) {
              extra[ valueKey ] = value.slice(valueBaseLength)
              value = value.slice(0, valueBaseLength)
            } else {
              extra[ valueKey ] = null
            }
            return {
              [typeKey]: DataTypesArray.indexOf(type),
              [valueKey]: value
            }
          })
        )
        return { base, extra }
      },
      async forList (attributes, { offset, limit, filter, sort } = {}) {
        const s = this

        return s.findAndCountAll({
          attributes: [ ...attributeValuesWith(attributes) ],
          where: parseFilter(filter, { attributes }),
          order: parseSort(sort, { attributes }),
          include: [
            { model: Entity.Extra, as: extraRefName }
          ],
          limit,
          offset
        })
      },
      async forOne (attributes, cid) {
        const cacheKey = Entity.cacheKeyFor(cid)
        const cached = Entity.forOneCache.get(cid)
        if (cached) {
          return cached
        }
        const found = await Entity.findOne({
          attributes: [ ...attributeValuesWith(attributes) ],
          include: [
            { model: Entity.Extra, as: extraRefName }
          ],
          where: { cid }
        })
        Entity.forOneCache.set(cacheKey, found)
        return found
      },
      cacheKeyFor (cid) {
        return cid
      }
    }
  })

  Entity.forOneCache = LRU({
    max: 500,
    maxAge: 1000 * 60 * 60
  })

  Entity.Extra = db.define(modelName + OVERFLOW_SUFFIX, {
    name: {
      comment: 'Name of attribute',
      type: STRING
    },
    value: {
      comment: 'Extra value',
      type: TEXT,
      allowNull: true
    }
  }, {
    freezeTableName: true,
    createdAt: false,
    updatedAt: false,
    indexes: [
      {
        unique: true,
        fields: [ modelIdName, 'name' ]
      }
    ]
  })

  Entity.hasMany(Entity.Extra, { as: 'Extras' })
  Entity.Extra.belongsTo(Entity)

  return Entity
}

module.exports = entityModel