/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from 'convex/server'

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    adapter: {
      create: FunctionReference<
        'mutation',
        'internal',
        {
          input:
            | {
                data: {
                  createdAt: number
                  email: string
                  emailVerified: boolean
                  foo?: null | string
                  image?: null | string
                  isAnonymous?: null | boolean
                  name: string
                  twoFactorEnabled?: null | boolean
                  updatedAt: number
                  userId?: null | string
                }
                model: 'user'
              }
            | {
                data: {
                  createdAt: number
                  expiresAt: number
                  ipAddress?: null | string
                  token: string
                  updatedAt: number
                  userAgent?: null | string
                  userId: string
                }
                model: 'session'
              }
            | {
                data: {
                  accessToken?: null | string
                  accessTokenExpiresAt?: null | number
                  accountId: string
                  createdAt: number
                  idToken?: null | string
                  password?: null | string
                  providerId: string
                  refreshToken?: null | string
                  refreshTokenExpiresAt?: null | number
                  scope?: null | string
                  updatedAt: number
                  userId: string
                }
                model: 'account'
              }
            | {
                data: {
                  createdAt: number
                  expiresAt: number
                  identifier: string
                  updatedAt: number
                  value: string
                }
                model: 'verification'
              }
            | {
                data: {
                  backupCodes: string
                  failedVerificationCount?: null | number
                  lockedUntil?: null | number
                  secret: string
                  userId: string
                  verified?: null | boolean
                }
                model: 'twoFactor'
              }
            | {
                data: {
                  alg?: null | string
                  createdAt: number
                  crv?: null | string
                  expiresAt?: null | number
                  privateKey: string
                  publicKey: string
                }
                model: 'jwks'
              }
          onCreateHandle?: string
          select?: Array<string>
        },
        any,
        Name
      >
      deleteMany: FunctionReference<
        'mutation',
        'internal',
        {
          input:
            | {
                model: 'user'
                where?: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'name'
                    | 'email'
                    | 'emailVerified'
                    | 'image'
                    | 'createdAt'
                    | 'updatedAt'
                    | 'twoFactorEnabled'
                    | 'isAnonymous'
                    | 'userId'
                    | 'foo'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
            | {
                model: 'session'
                where?: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'expiresAt'
                    | 'token'
                    | 'createdAt'
                    | 'updatedAt'
                    | 'ipAddress'
                    | 'userAgent'
                    | 'userId'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
            | {
                model: 'account'
                where?: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'accountId'
                    | 'providerId'
                    | 'userId'
                    | 'accessToken'
                    | 'refreshToken'
                    | 'idToken'
                    | 'accessTokenExpiresAt'
                    | 'refreshTokenExpiresAt'
                    | 'scope'
                    | 'password'
                    | 'createdAt'
                    | 'updatedAt'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
            | {
                model: 'verification'
                where?: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'identifier'
                    | 'value'
                    | 'expiresAt'
                    | 'createdAt'
                    | 'updatedAt'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
            | {
                model: 'twoFactor'
                where?: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'secret'
                    | 'backupCodes'
                    | 'userId'
                    | 'verified'
                    | 'failedVerificationCount'
                    | 'lockedUntil'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
            | {
                model: 'jwks'
                where?: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'publicKey'
                    | 'privateKey'
                    | 'createdAt'
                    | 'expiresAt'
                    | 'alg'
                    | 'crv'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
          onDeleteHandle?: string
          paginationOpts: {
            cursor: string | null
            endCursor?: string | null
            id?: number
            maximumBytesRead?: number
            maximumRowsRead?: number
            numItems: number
          }
        },
        any,
        Name
      >
      deleteOne: FunctionReference<
        'mutation',
        'internal',
        {
          input:
            | {
                model: 'user'
                where?: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'name'
                    | 'email'
                    | 'emailVerified'
                    | 'image'
                    | 'createdAt'
                    | 'updatedAt'
                    | 'twoFactorEnabled'
                    | 'isAnonymous'
                    | 'userId'
                    | 'foo'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
            | {
                model: 'session'
                where?: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'expiresAt'
                    | 'token'
                    | 'createdAt'
                    | 'updatedAt'
                    | 'ipAddress'
                    | 'userAgent'
                    | 'userId'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
            | {
                model: 'account'
                where?: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'accountId'
                    | 'providerId'
                    | 'userId'
                    | 'accessToken'
                    | 'refreshToken'
                    | 'idToken'
                    | 'accessTokenExpiresAt'
                    | 'refreshTokenExpiresAt'
                    | 'scope'
                    | 'password'
                    | 'createdAt'
                    | 'updatedAt'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
            | {
                model: 'verification'
                where?: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'identifier'
                    | 'value'
                    | 'expiresAt'
                    | 'createdAt'
                    | 'updatedAt'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
            | {
                model: 'twoFactor'
                where?: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'secret'
                    | 'backupCodes'
                    | 'userId'
                    | 'verified'
                    | 'failedVerificationCount'
                    | 'lockedUntil'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
            | {
                model: 'jwks'
                where?: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'publicKey'
                    | 'privateKey'
                    | 'createdAt'
                    | 'expiresAt'
                    | 'alg'
                    | 'crv'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
          onDeleteHandle?: string
        },
        any,
        Name
      >
      findMany: FunctionReference<
        'query',
        'internal',
        {
          join?: any
          limit?: number
          model:
            | 'user'
            | 'session'
            | 'account'
            | 'verification'
            | 'twoFactor'
            | 'jwks'
          offset?: number
          paginationOpts: {
            cursor: string | null
            endCursor?: string | null
            id?: number
            maximumBytesRead?: number
            maximumRowsRead?: number
            numItems: number
          }
          select?: Array<string>
          sortBy?: { direction: 'asc' | 'desc'; field: string }
          where?: Array<{
            connector?: 'AND' | 'OR'
            field: string
            mode?: 'sensitive' | 'insensitive'
            operator?:
              | 'lt'
              | 'lte'
              | 'gt'
              | 'gte'
              | 'eq'
              | 'in'
              | 'not_in'
              | 'ne'
              | 'contains'
              | 'starts_with'
              | 'ends_with'
            value:
              | string
              | number
              | boolean
              | Array<string>
              | Array<number>
              | null
          }>
        },
        any,
        Name
      >
      findOne: FunctionReference<
        'query',
        'internal',
        {
          join?: any
          model:
            | 'user'
            | 'session'
            | 'account'
            | 'verification'
            | 'twoFactor'
            | 'jwks'
          select?: Array<string>
          where?: Array<{
            connector?: 'AND' | 'OR'
            field: string
            mode?: 'sensitive' | 'insensitive'
            operator?:
              | 'lt'
              | 'lte'
              | 'gt'
              | 'gte'
              | 'eq'
              | 'in'
              | 'not_in'
              | 'ne'
              | 'contains'
              | 'starts_with'
              | 'ends_with'
            value:
              | string
              | number
              | boolean
              | Array<string>
              | Array<number>
              | null
          }>
        },
        any,
        Name
      >
      incrementOne: FunctionReference<
        'mutation',
        'internal',
        {
          input:
            | {
                increment: Record<string, number>
                model: 'user'
                set?: {
                  createdAt?: number
                  email?: string
                  emailVerified?: boolean
                  foo?: null | string
                  image?: null | string
                  isAnonymous?: null | boolean
                  name?: string
                  twoFactorEnabled?: null | boolean
                  updatedAt?: number
                  userId?: null | string
                }
                where: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'name'
                    | 'email'
                    | 'emailVerified'
                    | 'image'
                    | 'createdAt'
                    | 'updatedAt'
                    | 'twoFactorEnabled'
                    | 'isAnonymous'
                    | 'userId'
                    | 'foo'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
            | {
                increment: Record<string, number>
                model: 'session'
                set?: {
                  createdAt?: number
                  expiresAt?: number
                  ipAddress?: null | string
                  token?: string
                  updatedAt?: number
                  userAgent?: null | string
                  userId?: string
                }
                where: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'expiresAt'
                    | 'token'
                    | 'createdAt'
                    | 'updatedAt'
                    | 'ipAddress'
                    | 'userAgent'
                    | 'userId'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
            | {
                increment: Record<string, number>
                model: 'account'
                set?: {
                  accessToken?: null | string
                  accessTokenExpiresAt?: null | number
                  accountId?: string
                  createdAt?: number
                  idToken?: null | string
                  password?: null | string
                  providerId?: string
                  refreshToken?: null | string
                  refreshTokenExpiresAt?: null | number
                  scope?: null | string
                  updatedAt?: number
                  userId?: string
                }
                where: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'accountId'
                    | 'providerId'
                    | 'userId'
                    | 'accessToken'
                    | 'refreshToken'
                    | 'idToken'
                    | 'accessTokenExpiresAt'
                    | 'refreshTokenExpiresAt'
                    | 'scope'
                    | 'password'
                    | 'createdAt'
                    | 'updatedAt'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
            | {
                increment: Record<string, number>
                model: 'verification'
                set?: {
                  createdAt?: number
                  expiresAt?: number
                  identifier?: string
                  updatedAt?: number
                  value?: string
                }
                where: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'identifier'
                    | 'value'
                    | 'expiresAt'
                    | 'createdAt'
                    | 'updatedAt'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
            | {
                increment: Record<string, number>
                model: 'twoFactor'
                set?: {
                  backupCodes?: string
                  failedVerificationCount?: null | number
                  lockedUntil?: null | number
                  secret?: string
                  userId?: string
                  verified?: null | boolean
                }
                where: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'secret'
                    | 'backupCodes'
                    | 'userId'
                    | 'verified'
                    | 'failedVerificationCount'
                    | 'lockedUntil'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
            | {
                increment: Record<string, number>
                model: 'jwks'
                set?: {
                  alg?: null | string
                  createdAt?: number
                  crv?: null | string
                  expiresAt?: null | number
                  privateKey?: string
                  publicKey?: string
                }
                where: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'publicKey'
                    | 'privateKey'
                    | 'createdAt'
                    | 'expiresAt'
                    | 'alg'
                    | 'crv'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
          onUpdateHandle?: string
        },
        any,
        Name
      >
      updateMany: FunctionReference<
        'mutation',
        'internal',
        {
          input:
            | {
                model: 'user'
                update: {
                  createdAt?: number
                  email?: string
                  emailVerified?: boolean
                  foo?: null | string
                  image?: null | string
                  isAnonymous?: null | boolean
                  name?: string
                  twoFactorEnabled?: null | boolean
                  updatedAt?: number
                  userId?: null | string
                }
                where?: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'name'
                    | 'email'
                    | 'emailVerified'
                    | 'image'
                    | 'createdAt'
                    | 'updatedAt'
                    | 'twoFactorEnabled'
                    | 'isAnonymous'
                    | 'userId'
                    | 'foo'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
            | {
                model: 'session'
                update: {
                  createdAt?: number
                  expiresAt?: number
                  ipAddress?: null | string
                  token?: string
                  updatedAt?: number
                  userAgent?: null | string
                  userId?: string
                }
                where?: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'expiresAt'
                    | 'token'
                    | 'createdAt'
                    | 'updatedAt'
                    | 'ipAddress'
                    | 'userAgent'
                    | 'userId'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
            | {
                model: 'account'
                update: {
                  accessToken?: null | string
                  accessTokenExpiresAt?: null | number
                  accountId?: string
                  createdAt?: number
                  idToken?: null | string
                  password?: null | string
                  providerId?: string
                  refreshToken?: null | string
                  refreshTokenExpiresAt?: null | number
                  scope?: null | string
                  updatedAt?: number
                  userId?: string
                }
                where?: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'accountId'
                    | 'providerId'
                    | 'userId'
                    | 'accessToken'
                    | 'refreshToken'
                    | 'idToken'
                    | 'accessTokenExpiresAt'
                    | 'refreshTokenExpiresAt'
                    | 'scope'
                    | 'password'
                    | 'createdAt'
                    | 'updatedAt'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
            | {
                model: 'verification'
                update: {
                  createdAt?: number
                  expiresAt?: number
                  identifier?: string
                  updatedAt?: number
                  value?: string
                }
                where?: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'identifier'
                    | 'value'
                    | 'expiresAt'
                    | 'createdAt'
                    | 'updatedAt'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
            | {
                model: 'twoFactor'
                update: {
                  backupCodes?: string
                  failedVerificationCount?: null | number
                  lockedUntil?: null | number
                  secret?: string
                  userId?: string
                  verified?: null | boolean
                }
                where?: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'secret'
                    | 'backupCodes'
                    | 'userId'
                    | 'verified'
                    | 'failedVerificationCount'
                    | 'lockedUntil'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
            | {
                model: 'jwks'
                update: {
                  alg?: null | string
                  createdAt?: number
                  crv?: null | string
                  expiresAt?: null | number
                  privateKey?: string
                  publicKey?: string
                }
                where?: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'publicKey'
                    | 'privateKey'
                    | 'createdAt'
                    | 'expiresAt'
                    | 'alg'
                    | 'crv'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
          onUpdateHandle?: string
          paginationOpts: {
            cursor: string | null
            endCursor?: string | null
            id?: number
            maximumBytesRead?: number
            maximumRowsRead?: number
            numItems: number
          }
        },
        any,
        Name
      >
      updateOne: FunctionReference<
        'mutation',
        'internal',
        {
          input:
            | {
                model: 'user'
                update: {
                  createdAt?: number
                  email?: string
                  emailVerified?: boolean
                  foo?: null | string
                  image?: null | string
                  isAnonymous?: null | boolean
                  name?: string
                  twoFactorEnabled?: null | boolean
                  updatedAt?: number
                  userId?: null | string
                }
                where?: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'name'
                    | 'email'
                    | 'emailVerified'
                    | 'image'
                    | 'createdAt'
                    | 'updatedAt'
                    | 'twoFactorEnabled'
                    | 'isAnonymous'
                    | 'userId'
                    | 'foo'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
            | {
                model: 'session'
                update: {
                  createdAt?: number
                  expiresAt?: number
                  ipAddress?: null | string
                  token?: string
                  updatedAt?: number
                  userAgent?: null | string
                  userId?: string
                }
                where?: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'expiresAt'
                    | 'token'
                    | 'createdAt'
                    | 'updatedAt'
                    | 'ipAddress'
                    | 'userAgent'
                    | 'userId'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
            | {
                model: 'account'
                update: {
                  accessToken?: null | string
                  accessTokenExpiresAt?: null | number
                  accountId?: string
                  createdAt?: number
                  idToken?: null | string
                  password?: null | string
                  providerId?: string
                  refreshToken?: null | string
                  refreshTokenExpiresAt?: null | number
                  scope?: null | string
                  updatedAt?: number
                  userId?: string
                }
                where?: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'accountId'
                    | 'providerId'
                    | 'userId'
                    | 'accessToken'
                    | 'refreshToken'
                    | 'idToken'
                    | 'accessTokenExpiresAt'
                    | 'refreshTokenExpiresAt'
                    | 'scope'
                    | 'password'
                    | 'createdAt'
                    | 'updatedAt'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
            | {
                model: 'verification'
                update: {
                  createdAt?: number
                  expiresAt?: number
                  identifier?: string
                  updatedAt?: number
                  value?: string
                }
                where?: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'identifier'
                    | 'value'
                    | 'expiresAt'
                    | 'createdAt'
                    | 'updatedAt'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
            | {
                model: 'twoFactor'
                update: {
                  backupCodes?: string
                  failedVerificationCount?: null | number
                  lockedUntil?: null | number
                  secret?: string
                  userId?: string
                  verified?: null | boolean
                }
                where?: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'secret'
                    | 'backupCodes'
                    | 'userId'
                    | 'verified'
                    | 'failedVerificationCount'
                    | 'lockedUntil'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
            | {
                model: 'jwks'
                update: {
                  alg?: null | string
                  createdAt?: number
                  crv?: null | string
                  expiresAt?: null | number
                  privateKey?: string
                  publicKey?: string
                }
                where?: Array<{
                  connector?: 'AND' | 'OR'
                  field:
                    | 'publicKey'
                    | 'privateKey'
                    | 'createdAt'
                    | 'expiresAt'
                    | 'alg'
                    | 'crv'
                    | '_id'
                  mode?: 'sensitive' | 'insensitive'
                  operator?:
                    | 'lt'
                    | 'lte'
                    | 'gt'
                    | 'gte'
                    | 'eq'
                    | 'in'
                    | 'not_in'
                    | 'ne'
                    | 'contains'
                    | 'starts_with'
                    | 'ends_with'
                  value:
                    | string
                    | number
                    | boolean
                    | Array<string>
                    | Array<number>
                    | null
                }>
              }
          onUpdateHandle?: string
        },
        any,
        Name
      >
    }
  }
