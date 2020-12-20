# TQL

> Note: this is **pre-production software** at this point, see the **[current limitations](./CURRENT_LIMITATIONS.md)**.

**tql** is a fully TypeScript-native GraphQL operation writer; **codegen only when you schema changes**, **works with any GraphQL client**, **fully type-safe**.

- **Codegen once** - regenerate your GraphQL API client only when your schema changes.
- **Fully type-safe** - take advantage of the full power of TypeScript's advanced type-system.
- **Backendless** - integrate with any existing GraphQL client.

## Installation

`npm install @timkendall/tql` or `yarn add @timkendall/tql` 

* **TypeScript 4.1+** is required for [Recursive Conditional Type](https://devblogs.microsoft.com/typescript/announcing-typescript-4-1/#recursive-conditional-types) support

## Usage

You will need to compile a type-safe client one time before using. Do this with the provided CLI - `yarn tql <schema>`.

```typescript
import { query, execute } from '@timkendall/tql'

const operation = query("Example", (t) => [
  t.reviews({ episode: Episode.EMPIRE }, (t) => [
    t.stars(),
    t.commentary(),
  ]),

  t.human({ id: "1002" }, (t) => [
    t.__typename(),
    t.id(),
    t.name(),
    t.appearsIn(),
    t.homePlanet(),

    // @note Deprecated field should be properly picked-up by VSCode!
    t.mass(),

    t.friends((t) => [
      t.__typename(),
      t.id(),
      t.name(),
      t.appearsIn(),

      t.on("Human", (t) => [t.homePlanet()]),
      t.on("Droid", (t) => [t.primaryFunction()]),
    ]),

    t.starships((t) => [t.id(), t.name()]),
  ]),
]);
```

## Inspiration

I was inspired by the features and DSL's of [graphql-nexus](https://github.com/graphql-nexus/schema), [graphql_ppx](https://github.com/mhallin/graphql_ppx), [gqless](https://github.com/gqless/gqless), and [caliban](https://github.com/ghostdogpr/caliban).

## License

MIT