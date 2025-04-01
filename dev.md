- Generate Lib

npx nx generate @nx/js:library --directory=packages/apiref --bundler=esbuild --importPath=@sdk-it/apiref --linter=eslint --name=apiref --publishable=true --unitTestRunner=none --minimal=true --setParserOptionsProject=true --simpleName=true --useProjectJson=true --no-interactive


npx nx generate @nx/react:application --directory=packages/apiref --linter=eslint --name=apiref --compiler=swc --e2eTestRunner=none --globalCss=true --minimal=true --useProjectJson=true --useReactRouter=true --no-interactive