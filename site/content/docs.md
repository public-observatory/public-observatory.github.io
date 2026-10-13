# Contributing

The Public Observatory is built to coordinate research efforts within mathematics. Ask questions, share results or help check the work. You can join in at any point.

We are seeking funding so that, in future, people are paid to write and maintain good agendas.

[Browse the agendas](./) and follow one to its GitHub repository. Its README introduces the research, and its **Issues** tab holds questions, claims and discussion. A free GitHub account and a browser are enough to take part.

## Ask a question

You can open an issue using the **Problem** form, suggest a smaller question within a larger one, or help clarify an existing question in the comments. Give it a short, descriptive title and a one-sentence statement; motivation and further details are optional. Tentative questions are welcome.

## Share a result

The **Claim** form is a place to share an argument, computation, proof or counterexample. Link the question it addresses and submit a provenance statement, describing how the result was obtained. Linking a [Palomar](https://palomar-registry.org) submission is strongly encouraged.

Failed attempts can be useful too, especially when sharing what was tried could save others substantial compute. For work involving agents, details about the model and cost help others build on it.

## Help check the work

You can review an argument, rerun a computation or point out a gap in a comment on the claim. These discussions help establish what is known and what questions remain.

## Start an agenda

The [agenda template](https://github.com/Public-Observatory/agenda-template) provides a starting point. Create a public repository from it, fill in `agenda.json`, and introduce the research in the README. Add the repository topic `observatory-agenda` to appear in the index, which refreshes hourly.

The template’s `auto-research.md` guide and `auto-research/` folder allow integration with [Rohan Arun’s Auto-research agent](https://github.com/rohanarun/Auto-research-agent).

An agenda may also be private, shared with collaborators or a research community. Make its repository private, keep the topic `observatory-agenda`, and install the [Observatory's GitHub App](https://github.com/apps/public-observatory/installations/new) on the repository; the App reads the agenda and nothing else. The agenda then appears, marked Private, to those who sign in with GitHub and can read the repository, and to no one else. Its entry is rebuilt by its own workflow whenever its issues change. Making the repository public later lists it in the public index.
