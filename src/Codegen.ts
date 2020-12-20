import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLField,
  getNamedType,
  isListType,
  isNonNullType,
  GraphQLEnumType,
  GraphQLInterfaceType,
  GraphQLArgument,
  GraphQLInputObjectType,
  GraphQLOutputType,
  GraphQLNonNull,
  GraphQLList,
  GraphQLEnumValue,
  GraphQLInputField,
  GraphQLUnionType,
  GraphQLInputType,
} from "graphql";
import * as ts from "typescript";
import prettier from "prettier";

import { getBaseOutputType, getBaseInputType } from "./codegen/typescript";

const toPrimitive = (
  scalar: GraphQLScalarType
): "number" | "string" | "boolean" | "unknown" => {
  switch (scalar.name) {
    case "ID":
    case "String":
      return "string";
    case "Boolean":
      return "boolean";
    case "Int":
    case "Float":
      return "number";
    default:
      return "unknown";
  }
};

const renderInterfaceField = (field: GraphQLField<any, any, any>): string => {
  const isList =
    field.type instanceof GraphQLList ||
    (field.type instanceof GraphQLNonNull &&
      field.type.ofType instanceof GraphQLList);
  const isNonNull = field.type instanceof GraphQLNonNull;
  const baseType = getBaseOutputType(field.type);

  if (baseType instanceof GraphQLScalarType) {
    return `${field.name}: ${toPrimitive(baseType)}` + (isList ? "[]" : "");
  } else if (baseType instanceof GraphQLEnumType) {
    return `${field.name}: ${baseType.name}` + (isList ? "[]" : "");
  } else if (
    baseType instanceof GraphQLInterfaceType ||
    baseType instanceof GraphQLObjectType
  ) {
    return `${field.name}: I${baseType.name}` + (isList ? "[]" : "");
  } else {
    return `${field.name}: any`;
  }
};

export class Codegen {
  private readonly printer = ts.createPrinter();
  private readonly source: ts.SourceFile;

  constructor(
    public readonly schema: GraphQLSchema,
    public readonly target: ts.ScriptTarget = ts.ScriptTarget.ES2020
  ) {
    this.source = ts.createSourceFile("", "", target);
  }

  private get imports() {
    return [
      `
    import {
      Argument,
      Value,
      Field,
      Operation,
      Selection,
      SelectionSet,
      Variable,
    } from '../src'
    `,
    ];
  }

  private get query() {
    return `
      export const query = <T extends Array<Selection>>(
        name: string,
        select: (t: typeof Query) => T
      ): Operation<SelectionSet<T>> => new Operation(name, "query", new SelectionSet(select(Query)))
    `;
  }

  public render(): string {
    const types = Object.values(this.schema.getTypeMap()).filter(
      ({ name }) => !name.startsWith("__")
    ); // @note filter internal types

    const enums = types
      .filter((type) => type instanceof GraphQLEnumType)
      .map((type) => this.enumType(type as GraphQLEnumType));

    const interfaces = types
      .filter((type) => type instanceof GraphQLInputObjectType)
      .map((type) => this.inputObjectType(type as GraphQLInputObjectType));

    const unions = types
      .filter((type) => type instanceof GraphQLUnionType)
      .map((type) => this.unionType(type as GraphQLUnionType));

    const consts = types
      .filter(
        (type) =>
          type instanceof GraphQLInterfaceType ||
          type instanceof GraphQLObjectType
      )
      .map((type) => {
        if (type instanceof GraphQLInterfaceType) {
          return this.interfaceType(type);
        } else if (type instanceof GraphQLObjectType) {
          return this.objectType(type);
        } else {
          return "";
        }
      });

    const text = [
      ...this.imports,
      ...enums,
      ...interfaces,
      ...unions,
      ...consts,
      this.query,
    ];

    return prettier.format(text.join("\n\n"), { parser: "typescript" });
  }

  private enumType(type: GraphQLEnumType): string {
    const values = type.getValues();

    const renderMember = (enumValue: GraphQLEnumValue): string => {
      return `${enumValue.name} = "${enumValue.value}"`;
    };

    return `
      export enum ${type.name} {
        ${values.map(renderMember).join(",\n")}
      }
    `;
  }

  private interfaceType(type: GraphQLInterfaceType): string {
    const fields = Object.values(type.getFields());

    // @note Render interface types and selector objects
    return `
      export interface I${type.name} {
        __typename: string
        ${fields.map(renderInterfaceField).join("\n")}
      }

      export const ${type.name} = {
        ${fields.map((field) => this.field(field)).join("\n")}
      }
    `;
  }

  private unionType(type: GraphQLUnionType): string {
    console.warn(
      `Skipping union type "${type.name}". Union types are not supported yet.`
    );
    return `// "${type.name}" is a union type and not supported`;
  }

  private objectType(type: GraphQLObjectType): string {
    const fields = Object.values(type.getFields());

    const interfaces = type.getInterfaces();

    if (interfaces.length > 0) {
      // @note TypeScript only requires new fields to be defined on interface extendors
      const interfaceFields = interfaces.flatMap((i) =>
        Object.values(i.getFields()).map((field) => field.name)
      );
      const uncommonFields = fields.filter(
        (field) => !interfaceFields.includes(field.name)
      );

      return `
        export interface I${type.name} extends ${interfaces
        .map((i) => "I" + i.name)
        .join(", ")} {
          __typename: "${type.name}"
          ${uncommonFields.map(renderInterfaceField).join("\n")}
        }

        export const ${type.name} = {
          ${fields.map((field) => this.field(field)).join("\n")}
        }
      `;
    } else {
      return `
        export interface I${type.name} {
          ${fields.map(renderInterfaceField).join("\n")}
        }

        export const ${type.name} = {
          ${fields.map((field) => this.field(field)).join("\n")}
        }
      `;
    }
  }

  private inputObjectType(type: GraphQLInputObjectType): string {
    const fields = Object.values(type.getFields());

    return `
      export interface ${type.name} {
        ${fields.map((field) => this.inputField(field)).join("\n")}
      }
    `;
  }

  private inputField(inputField: GraphQLInputField): string {
    const isList =
      inputField.type instanceof GraphQLList ||
      (inputField.type instanceof GraphQLNonNull &&
        inputField.type.ofType instanceof GraphQLList);
    const isNonNull = inputField.type instanceof GraphQLNonNull;

    const baseType = getBaseInputType(inputField.type);

    // @todo render correct TypeScript type

    return isNonNull
      ? `${inputField.name}: unknown`
      : `${inputField.name}?: unknown`;
  }

  private field(field: GraphQLField<any, any, any>): string {
    const { name, args, type, deprecationReason } = field;

    const isList =
      type instanceof GraphQLList ||
      (type instanceof GraphQLNonNull && type.ofType instanceof GraphQLList);
    const isNonNull = type instanceof GraphQLNonNull;
    const baseType = getBaseOutputType(type);

    // @todo If `GraphQLInterfaceType` or `GraphQLUnionType` define a new "merged" `Selector`?

    const deprecatedComment = deprecationReason
      ? `
    /**
     * @deprecated ${deprecationReason}
     */
    `
      : "";

    if (
      baseType instanceof GraphQLScalarType ||
      baseType instanceof GraphQLEnumType
    ) {
      const fieldType =
        baseType instanceof GraphQLScalarType
          ? toPrimitive(baseType)
          : baseType.name;

      // @todo render arguments correctly
      return args.length > 0
        ? deprecatedComment.concat(
            `${name}: (variables: { ${args
              .map((a) => `${a.name}: unknown`)
              .join(
                ", "
              )} }) => new Field<"${name}", [/* @todo */]>("${name}"),`
          )
        : deprecatedComment.concat(`${name}: () => new Field("${name}"),`);
    } else {
      const renderArgument = (arg: GraphQLArgument): string => {
        const _base = getBaseInputType(arg.type);

        // @note Janky enum value support
        return _base instanceof GraphQLEnumType
          ? `new Argument("${arg.name}", variables.${arg.name}, ${_base.name})`
          : `new Argument("${arg.name}", variables.${arg.name})`;
      };

      const renderInputType = (type: GraphQLInputType): string => {
        const _base = getBaseInputType(type);

        if (_base instanceof GraphQLScalarType) {
          return toPrimitive(_base);
        } else if (_base instanceof GraphQLEnumType) {
          return _base.name;
        } else {
          return "unknown";
        }
      };

      const renderVariable = (arg: GraphQLArgument): string => {
        return arg instanceof GraphQLNonNull
          ? `${arg.name}: Variable<"${arg.name}"> | ${renderInputType(
              arg.type
            )}`
          : `${arg.name}?: Variable<"${arg.name}"> | ${renderInputType(
              arg.type
            )}`;
      };

      // @todo render arguments correctly
      // @todo restrict allowed Field types
      return args.length > 0
        ? `
        ${deprecatedComment}
        ${name}: <T extends Array<Field<any, any, any>>>(
          variables: { ${args.map(renderVariable).join(", ")} },
          select: (t: typeof ${baseType.toString()}) => T
        ) => new Field("${name}", [ ${args
            .map(renderArgument)
            .join(", ")} ], new SelectionSet(select(${baseType.toString()}))),
      `
        : `
        ${deprecatedComment}
        ${name}: <T extends Array<Field<any, any, any>>>(
          select: (t: typeof ${baseType.toString()}) => T
        ) => new Field("${name}", [], new SelectionSet(select(${baseType.toString()}))),
      `;
    }
  }
}
