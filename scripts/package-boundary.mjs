// A development-only artifact verifier. Analyze syntax (never source-name substrings),
// so licenses, schema identities and declaration type references remain legal.
import ts from 'typescript';
import { readFileSync, existsSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { builtinModules } from 'node:module';
import { createHash } from 'node:crypto';
const SDK='hanaworlds-contracts';
const fail=(code,detail)=>{throw Error(`${code}: ${detail}`);};
const productionTargets=value=>typeof value==='string'?[value]:value&&typeof value==='object'?Object.entries(value).filter(([condition])=>condition!=='development').flatMap(([,target])=>productionTargets(target)):[];
const targets = value => typeof value==='string'?[value]:value && typeof value==='object'?Object.values(value).flatMap(targets):[];
export function verifyPackage(dir) {
 const root=resolve(dir), pkg=JSON.parse(readFileSync(join(root,'package.json')));
 for(const field of ['dependencies','peerDependencies','optionalDependencies'])
  for(const [name,spec] of Object.entries(pkg[field]??{})) {
   if(name===SDK || spec.includes('hanaworlds-contracts')) fail('PRODUCTION_CONTRACT_DEPENDENCY',field);
   if(/^(?:file:|link:|workspace:|git|https?:)/.test(spec)) fail('EXOTIC_PRODUCTION_DEPENDENCY',name);
  }
 if(pkg.devDependencies?.[SDK]!=='git+https://github.com/yzsnstotz/hanaworlds-contracts.git#v2.14.0') fail('DEVELOPMENT_SUPPLY_MISMATCH',SDK);
 if(pkg.imports?.['#contracts']?.development!=='./dist/contracts.mjs'||pkg.imports?.['#contracts']?.default!=='./dist/runtime/contracts.mjs'||existsSync(join(root,'dist/contracts.mjs')))fail('DEVELOPMENT_MODULE_BOUNDARY',SDK);
 const closure=new Set(), external=new Set(), resources=new Set();
 const local = (path, owner, directory=false) => {
  const p=resolve(root,path);
  if(relative(root,p).startsWith('..') || !existsSync(p) || lstatSync(p).isSymbolicLink()) fail('UNPACKED_LOCAL_DEPENDENCY',`${owner}: ${path}`);
  if(lstatSync(p).isDirectory()) {
   if(!directory) fail('UNPACKED_LOCAL_DEPENDENCY',`${owner}: directory ${path}`);
   for(const n of readdirSync(p)) local(relative(root,join(p,n)),owner,true);
   return;
  }
  resources.add(relative(root,p));
  if(/\.(?:mjs|cjs|js)$/.test(p)) visit(p);
 };
 const dependency = (spec, owner) => {
  if(spec===SDK||spec.startsWith(SDK+'/')||spec==='#contracts') fail('CONTRACT_RUNTIME_LOAD',`${owner}: ${spec}`);
  if(spec.endsWith('.d.ts'))fail('DECLARATION_VALUE_LOAD',spec);
  if(spec.startsWith('.')) return local(relative(root,resolve(dirname(owner),spec)),owner);
  if(spec.startsWith('#')) {
   const paths=productionTargets(pkg.imports?.[spec]);if(!paths.length)fail('UNRESOLVED_PACKAGE_IMPORT',spec);
   return paths.forEach(p=>dependency(p,join(root,'package.json')));
  }
  if(spec==='node:module'||spec==='module')fail('DYNAMIC_MODULE_LOADER',spec);
  if(spec.startsWith('node:')||builtinModules.includes(spec)) return;
  if(/^(?:\/|file:|https?:)/.test(spec))fail('EXTERNAL_RESOURCE_LOAD',spec);
  const name=spec.startsWith('@')?spec.split('/').slice(0,2).join('/'):spec.split('/')[0];
  if(!pkg.dependencies?.[name]&&!pkg.peerDependencies?.[name]&&!pkg.optionalDependencies?.[name]) fail('UNDECLARED_RUNTIME_DEPENDENCY',spec);
  external.add(spec);
 };
 function visit(file) {
  if(closure.has(file))return; closure.add(file);
  const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  if(source.parseDiagnostics.length)fail('INVALID_RUNTIME_SYNTAX',file);
  const variables=new Map(), readNames=new Set(['readFile','readFileSync','fetch']);
  function collect(n){
   if(ts.isVariableDeclaration(n)&&ts.isIdentifier(n.name)&&n.initializer)variables.set(n.name.text,n.initializer);
   if(ts.isImportDeclaration(n)&&n.importClause?.namedBindings&&ts.isNamedImports(n.importClause.namedBindings))
    for(const binding of n.importClause.namedBindings.elements)
     if(['readFile','readFileSync'].includes(binding.propertyName?.text??binding.name.text))readNames.add(binding.name.text);
   ts.forEachChild(n,collect);
  }
  collect(source);
  function resourceText(n,seen=new Set()) {
   if(ts.isStringLiteralLike(n))return n.text;
   if(ts.isIdentifier(n)&&variables.has(n.text)&&!seen.has(n.text))return resourceText(variables.get(n.text),new Set([...seen,n.text]));
   if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.PlusToken)return resourceText(n.left,seen)+resourceText(n.right,seen);
   if(ts.isCallExpression(n)||ts.isNewExpression(n))return n.expression.getText(source)+' '+(n.arguments??[]).map(a=>resourceText(a,seen)).join('/');
   return n.getText(source);
  }
  function walk(n) {
   if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier)dependency(n.moduleSpecifier.text,file);
   if(ts.isCallExpression(n)) {
    const expr=n.expression.getText(source);
    if(n.expression.kind===ts.SyntaxKind.ImportKeyword||['require','require.resolve','import.meta.resolve','module.require'].includes(expr)) {
     const arg=n.arguments[0]; if(!arg||!ts.isStringLiteralLike(arg))fail('DYNAMIC_MODULE_LOAD',`${file}: ${expr}`);
     dependency(arg.text,file);
    }
    // SDK/package/resource paths cannot be obtained via a computed external resolver.
    if(expr==='eval'||/(?:createRequire|Function)$/.test(expr)) fail('DYNAMIC_MODULE_LOADER',file);
    if(readNames.has(expr)||/(?:readFile(?:Sync)?|fetch)$/.test(expr)) {
     for(const a of n.arguments) {
      const text=resourceText(a);
      if(/hanaworlds-contracts|node_modules|(?:https?|file):\/\/|\b(?:process\.env|import\.meta\.resolve)\b/.test(text)) fail('EXTERNAL_RESOURCE_READ',`${file}: ${expr}`);
     }
    }
   }
   if(ts.isNewExpression(n)&&n.expression.getText(source)==='Function')fail('DYNAMIC_MODULE_LOADER',file);
   if(ts.isNewExpression(n)&&n.expression.getText(source)==='URL'&&n.arguments?.[1]?.getText(source)==='import.meta.url') {
    const a=n.arguments[0];if(!ts.isStringLiteralLike(a))fail('DYNAMIC_ARTIFACT_RESOURCE',file);
    local(relative(root,resolve(dirname(file),a.text)),file,a.text.endsWith('/'));
   }
   ts.forEachChild(n,walk);
  }
  walk(source);
 }
 for(const target of targets(pkg.exports)) {
  if(target.endsWith('.d.ts')) {
   local(target,'declarations');
   const declaration=ts.createSourceFile(target,readFileSync(join(root,target),'utf8'),ts.ScriptTarget.Latest,true);
   function types(n){
    const spec=(ts.isImportDeclaration(n)||ts.isExportDeclaration(n))?n.moduleSpecifier:ts.isImportTypeNode(n)&&ts.isLiteralTypeNode(n.argument)?n.argument.literal:null;
    if(spec&&ts.isStringLiteralLike(spec)&&spec.text.startsWith('.')) {
     const path=relative(root,resolve(dirname(join(root,target)),spec.text)).replace(/\.js$/,'.d.ts');
     local(path,'declaration import');
    }
    ts.forEachChild(n,types);
   }
   types(declaration);
  }else local(target,'exports');
 }
 // All import targets and every packed executable are checked, including currently dormant helpers.
 for(const target of productionTargets(pkg.imports)) local(target,'package imports');
 function all(path){for(const n of readdirSync(path)){const p=join(path,n);if(lstatSync(p).isDirectory())all(p);else if(/\.(mjs|cjs|js)$/.test(p))visit(p);}}
 all(root);
 const meta=JSON.parse(readFileSync(join(root,'dist/runtime-build.json')));
 if(meta.sourceVersion!=='2.14.0'||meta.sourceTag!=='v2.14.0'||!meta.sourceResolved.endsWith('#39781da25e28738e5243e6379e2cad0e03e03b3f'))fail('BUILD_SOURCE_MISMATCH',meta.sourceResolved);
 for(const [path,expected] of Object.entries(meta.sha256)) {
  local(path,'build manifest'); const hash=createHash('sha256').update(readFileSync(join(root,path))).digest('hex');
  if(hash!==expected)fail('ARTIFACT_DIGEST_MISMATCH',path);
 }
 return {exports:pkg.exports,modules:[...closure].map(p=>relative(root,p)).sort(),resources:[...resources].sort(),external:[...external].sort(),source:meta.sourceResolved};
}
