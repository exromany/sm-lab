# TODO

- rename `csm-lab` -> `sm-lab`
- apps: drop `-mock` postfix (`npx @sm-lab/cl`)
- cleanup meaningless comments
- readme: drop migration sections, drop CORS notes
- improve help everythere
- min node version: 24, for docker too

---

- how to be 'agentic-first' ?
- rename project folder + gh repo (manual: GitHub Settings → rename, `git remote set-url`)
- shell completion for tools/apps; well-described commands/options for agents
- harden mock `/admin/*` routes: require an auth token + refuse to bind non-loopback
- cl-mock proxy: relay upstream validator epoch fields faithfully (currently synthetic)
