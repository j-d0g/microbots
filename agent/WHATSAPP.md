[21/04/2026, 14:04:38] Jordan: hey
[21/04/2026, 14:04:48] Jordan: you going to the hack this weekend?
[21/04/2026, 15:32:03] Desmond SurrealDB: Hey Jordan, the unicorn mafia one yep
[21/04/2026, 15:37:53] Desmond SurrealDB: Do you have ideas/team?
[21/04/2026, 17:17:39] Desmond SurrealDB: ‎This message was deleted.
[21/04/2026, 17:50:46] Desmond SurrealDB: I was going to build a feature for my startup but I think if we team up +3rd we should build a product from scratch and have it super focussed on winning this hack rather than repurposing old cold
[21/04/2026, 17:50:48] Desmond SurrealDB: Code
[21/04/2026, 20:02:30] Jordan: Yeah i have an idea
[21/04/2026, 20:02:32] Jordan: I have a couple
[21/04/2026, 20:02:38] Jordan: That are somewhat adjacent
[21/04/2026, 20:04:19] Desmond SurrealDB: Ok do you have a 3rd member?
[21/04/2026, 20:04:24] Desmond SurrealDB: I think we can win this
[21/04/2026, 20:05:12] Jordan: He didn’t get accepted sadly
[21/04/2026, 20:05:28] Jordan: But I know a few people at the hack
[21/04/2026, 20:05:51] Jordan: Just cautious about who to bring in
[21/04/2026, 20:06:18] Jordan: Bc it’s kind of easier to do while orchestrating a Claude army than delegating work to people who don’t really get it
[21/04/2026, 20:06:30] Jordan: And it might be one of those ideas
[21/04/2026, 20:06:41] Jordan: I’ll copy and paste what I sent to my mate, hold on
[21/04/2026, 20:07:57] Jordan: Idea 2 is auto-harness (i.e claude code for non-technicals where we manage automatic context & harness engineering, tooling provisioning, infra deploying, integrations via composio etc.) so that 10x openclaw/claude-code leverage gets democratised beyond developers. We manage the opinionated flows: spec-driven development, plan/build modes, sub-agents, context-engineering, tooling, even what to build/automate based on the ontology layer from swarming your integrations. You just use, interact, and steer the system by occasionally clarifying intent or building one-offs.  

It's a system that learns from things you do or ask for often, and evolves by automating regulars and recomposing your builds and eco-system. This all sounds ambitious, but lots of things can be supplied out-the-box - so many open-source solutions for memory, knowledge-wikis, and agent-sdk's exist for 70% functionality we need. We just need to stitch together the harness, and get a working demo-case, not a production-ready solution that generalises.  

References and inspo from:  https://www.hyperspell.com/ https://edra.ai/ https://factory.ai/ https://github.com/garrytan/gbrain https://codewords.agemo.ai/
[21/04/2026, 20:08:30] Desmond SurrealDB: So I know the founder of hyperspell haha
[21/04/2026, 20:08:46] Jordan: Aha interesting
[21/04/2026, 20:09:30] Desmond SurrealDB: The thing is ok for hacks over realised even if they say it’s got to be technical and whatnot they either want to see a flashy super cool ui and concept or they want benched Eval driven results
[21/04/2026, 20:09:36] Desmond SurrealDB: We’d win if you have both
[21/04/2026, 20:09:47] Jordan: My thoughts are render can be used as the infra to host the micro service workflows we build users.

Use an existing solution to build a context layer from integrations. Use composio as integrations provider. Derive memories from that
[21/04/2026, 20:09:53] Jordan: Yeah we can get a nice UI for this
[21/04/2026, 20:10:18] Jordan: It’s basically a coding agent interface on easy mode. We only really need to demo building one or two things with it e2e
[21/04/2026, 20:10:33] Desmond SurrealDB: My startup is on agentic specifications
[21/04/2026, 20:11:09] Desmond SurrealDB: I feel that sota evals will win this hack
[21/04/2026, 20:11:10] Jordan: Like building spec docs for long running agents?
[21/04/2026, 20:11:44] Desmond SurrealDB: Many people will build flashy UIs doing post training or sft/rl and benching results for a specific niche problem we’ve validated will instantly raise our chances
[21/04/2026, 20:12:10] Desmond SurrealDB: No automated specs for gov and enterprise
[21/04/2026, 20:12:15] Jordan: Yeah tho I know the judges and they aren’t really research driven
[21/04/2026, 20:12:16] Desmond SurrealDB: But anyways we’re still in stealth
[21/04/2026, 20:12:47] Jordan: They’re building knowledge graphs for agents and enterprise atm
[21/04/2026, 20:12:54] Jordan: And like practicality
[21/04/2026, 20:13:05] Jordan: Two of them judged my last hack
[21/04/2026, 20:13:14] Desmond SurrealDB: What do they like
[21/04/2026, 20:13:35] Jordan: Knowledge graphs, practical usecases, enterprise pitch
[21/04/2026, 20:14:23] Jordan: I have another idea which is the enterprise version of my idea but it’s less demo friendly I.w easy to demo a product/ui
[21/04/2026, 20:17:33] Desmond SurrealDB: I think somewhere in the product there needs to be a clear reason why our agentic system is better and that probably means writing an eval or some sort and benching against other sota systems I don’t think any other team will do this everyone is focussed on product features but those are subjective we need an objective way to win
[21/04/2026, 20:26:08] Jordan: Hm, I think we can bench the above idea quite easily.

It’s a system that self-improves the more you use it.

It solves a genuine problem, I.e democratising SaaS by handing the infra, code and harness all in one.

You signal intent by asking it to complete daily tasks, it builds composable blocks from your chats and automates them by building workflows, automations, or general purpose software.

It’s codewords.ai but with an ontology layer that means agents can build value before you even ask.
[21/04/2026, 20:29:26] Jordan: I think the value proposition is night and day and not in benchmarks here: vibe coders writing application logic locally and nowhere to host securely, and having to handle memory, context, sandboxing, harness principles etc.

Lovable is mostly FE, CC/OpenClaw are local, most solutions require hands on and self-leading approach. I feel a system that gets you without much prompting and adds value without friction could be sticky.

But if we want to bench we could just show results before and after using memory knowledge graph.
[21/04/2026, 20:33:33] Desmond SurrealDB: I think it’s a good start for the idea but the risk is in the product, also on the why us question over competitors. For evals I was thinking more our product vs the sota on the market currently, that’s super compelling to judges
[21/04/2026, 20:34:08] Jordan: Yeah I don’t know if there is a direct competitor in this space right now
[21/04/2026, 20:34:41] Desmond SurrealDB: If we can get it to the point where the audience can try it out live and it works
[21/04/2026, 20:37:40] Desmond SurrealDB: Have you seen sparkles
[21/04/2026, 20:39:11] Jordan: I think we could.

Every workflow or artefact is a python micro service to keep the scope small.

It runs on e2b sandbox, hosted on Render.

Plug in an Agent SDK and you already have out the box coding intelligence.

The moat is in the context, the memory, and the harness. Building correct code isn’t really a bottleneck with agents anymore, it’s building the right thing.

A system that just builds 70% of the low hanging fruit automations you never bothered to because it’s lying in slack messages and notion cluttered spaces could be a viral demo moment?
[21/04/2026, 20:39:16] Jordan: Nah
[21/04/2026, 20:39:43] Jordan: What is it
[21/04/2026, 20:40:00] Jordan: Also what are your thoughts, what are you more confident in working on, and any ideas
[21/04/2026, 20:41:28] Desmond SurrealDB: Non technicals can change the codebase
[21/04/2026, 20:42:17] Jordan: It’s still user driven though right ‎<This message was edited>
[21/04/2026, 20:42:33] Jordan: Non technicals need to articulate what they want to build
[21/04/2026, 20:43:36] Desmond SurrealDB: Yes ok if we can get the demo live and working for judges to try +somehow show that the code output performs at the same level as cursor (take hle and bench both systems shouldn’t be too hard) then I think it’s compelling
[21/04/2026, 20:44:06] Desmond SurrealDB: What about the why is to build it and not just the zapier and Claude approach
[21/04/2026, 20:44:24] Desmond SurrealDB: Also the scope is quite wide at the moment , perhaps narrow for the hack to start with
[21/04/2026, 20:44:34] Jordan: I work at codewords
[21/04/2026, 20:44:39] Desmond SurrealDB: Ok
[21/04/2026, 20:44:59] Jordan: And ive been building a few adjacent things so I can strip a minimal scaffolding
[21/04/2026, 20:45:07] Jordan: We can use render instead since they’re a sponsor
[21/04/2026, 20:45:13] Jordan: For the infra
[21/04/2026, 20:45:18] Desmond SurrealDB: Yeo
[21/04/2026, 20:45:20] Desmond SurrealDB: Yep
[21/04/2026, 20:45:35] Jordan: Zappier isn’t ai first
[21/04/2026, 20:45:39] Jordan: Workflows are too basic
[21/04/2026, 20:45:56] Desmond SurrealDB: Ok fair enough I think we have a good case if the product works on live demo
[21/04/2026, 20:46:21] Jordan: It should we just need to target a specific use case to work really well
[21/04/2026, 20:46:30] Jordan: Demo’s are short
[21/04/2026, 20:46:33] Desmond SurrealDB: That’s what I’m thinking
[21/04/2026, 20:46:48] Desmond SurrealDB: Who do you want as the 3rd
[21/04/2026, 20:47:06] Jordan: maybe someone on FE or a platform engineer on backend/infra
[21/04/2026, 20:47:11] Desmond SurrealDB: Do they have a niche domain knowledge we can use to pinpoint the use case
[21/04/2026, 20:47:14] Desmond SurrealDB: Ok
[21/04/2026, 20:47:21] Jordan: Tbh there’s a guy
[21/04/2026, 20:47:28] Jordan: Who built a knowledge graph repo
[21/04/2026, 20:47:34] Jordan: In the hack who’d be ideal
[21/04/2026, 20:47:46] Desmond SurrealDB: Do you know them
[21/04/2026, 20:50:28] Jordan: No
[21/04/2026, 20:50:31] Jordan: of them only
[21/04/2026, 20:50:35] Jordan: they’d be perfect ngl
[21/04/2026, 20:50:53] Jordan: his repo got 30k stars
[21/04/2026, 20:53:17] Jordan: You got a min?
[21/04/2026, 20:53:19] Jordan: ‎Voice call, ‎No answer
[21/04/2026, 20:53:38] Jordan: Just checked the sponsors
[21/04/2026, 20:53:43] Jordan: I think we can win if we pull this off
[21/04/2026, 20:56:00] Jordan: If we pull it off right we can win every sponsor too
[21/04/2026, 21:05:54] Desmond SurrealDB: ‎Voice call, ‎1 hr
[21/04/2026, 21:40:53] Jordan: https://www.linkedin.com/in/safi-shamsi?trk=sent_member-name
[21/04/2026, 22:13:56] Jordan: https://www.linkedin.com/in/devansh-karia
[21/04/2026, 22:42:12] Jordan: https://www.linkedin.com/in/aadhav-sakthivel/
[21/04/2026, 22:47:31] Desmond SurrealDB: Heads down SWE is what we want 😅😅 I do think we should call people we want to work with before we decide though we can figure this out in the next few days
[21/04/2026, 22:47:44] Jordan: I have like 5 dms
[21/04/2026, 22:47:46] Jordan: Alr
[21/04/2026, 22:47:51] Jordan: Asking about what the idea is
[21/04/2026, 22:47:58] Jordan: I’m struggling to find the words 😂
[21/04/2026, 22:47:58] Desmond SurrealDB: What are you going to say
[21/04/2026, 22:48:04] Jordan: Whats our one liner
[21/04/2026, 22:48:26] Desmond SurrealDB: Just say we have an idea to turn SAAS into service as a software and democratise technical workflows
[21/04/2026, 22:53:03] Jordan: ‘hey. we’re building a product heavy on the memory & harness layer to democratise saas & agentic development’
[21/04/2026, 22:55:46] Desmond SurrealDB: sounds good
[21/04/2026, 23:11:50] Jordan: https://www.linkedin.com/in/dav-id-7b6160222?utm_source=share_via&utm_content=profile&utm_medium=member_android
[21/04/2026, 23:13:28] Desmond SurrealDB: Could be a good fit
[21/04/2026, 23:14:15] Desmond SurrealDB: But let’s keep options for now
[21/04/2026, 23:15:30] Jordan: could be - but lots of unknowns
[21/04/2026, 23:15:52] Jordan: we aren’t looking for mle/ research heavy guys either
[21/04/2026, 23:23:52] Desmond SurrealDB: Yh ideally they should just have shown proof that they can build solutions fast that work
[21/04/2026, 23:38:27] Jordan:
‎[21/04/2026, 23:38:27] Jordan: ‎image omitted
‎[21/04/2026, 23:38:27] Jordan: ‎image omitted
[21/04/2026, 23:38:49] Jordan: https://devpost.com/software/strikezone-vylqht
this was most recent one
[21/04/2026, 23:38:56] Jordan: https://contxt-site.vercel.app/#timetravel
[21/04/2026, 23:44:06] Desmond SurrealDB: its just a landing page but ok
[21/04/2026, 23:52:25] Jordan: how long do you want to hedge for? ideally we team before the event so we have Friday to align
[21/04/2026, 23:52:40] Jordan: so might have to firm teaming up before it gets to the day
[22/04/2026, 00:02:43] Desmond SurrealDB: yes im happy with deciding before the weekend but we should have a quick call with people we're thinking of to see
[22/04/2026, 00:13:10] Jordan: break out rooms & leetcode style?
[22/04/2026, 00:50:19] Desmond SurrealDB: 😅😅
[22/04/2026, 14:20:53] Desmond SurrealDB: https://www.linkedin.com/in/mahmoud-ayach-25339021b?utm_source=share_via&utm_content=profile&utm_medium=member_ios
[22/04/2026, 14:22:03] Jordan: Yeah
[22/04/2026, 14:22:11] Jordan: We’re in sync
‎[22/04/2026, 14:22:21] Jordan: ‎image omitted
[22/04/2026, 14:28:16] Desmond SurrealDB: haha great
[22/04/2026, 14:28:42] Jordan: We could re-purpose this to fine-tune the harness 

https://github.com/karpathy/autoresearch
[22/04/2026, 14:29:57] Desmond SurrealDB: interesting ok yes
[22/04/2026, 21:20:19] Jordan: Got another 2 opts
[22/04/2026, 21:20:31] Desmond SurrealDB: Ok should we do calls tomorrow?
‎[22/04/2026, 21:20:48] Jordan: ‎image omitted
‎[22/04/2026, 21:21:13] Jordan: https://www.linkedin.com/in/alexz3?utm_source=share_via&utm_content=profile&utm_medium=member_ios ‎image omitted
[22/04/2026, 21:21:16] Jordan: Yeah can do
[22/04/2026, 21:21:48] Desmond SurrealDB: This guy sounds more creative and like me than technical heads down builder
[22/04/2026, 21:21:56] Jordan: Yup I got that too
[22/04/2026, 21:22:03] Desmond SurrealDB: Saw this guy he’s research right
[22/04/2026, 21:22:14] Jordan: Yeah. Neither are our ICP lol
[22/04/2026, 21:22:25] Jordan: But the researcher seems to have a good head on his shoulders
[22/04/2026, 21:22:38] Desmond SurrealDB: Lets call him tomorrow anyways
[22/04/2026, 21:23:00] Desmond SurrealDB: When do you have time tomorrow
[22/04/2026, 21:27:13] Jordan: late
[22/04/2026, 21:27:41] Jordan: maybe 7pm onwards
[22/04/2026, 21:27:44] Jordan: or possibly 6
[22/04/2026, 21:27:44] Desmond SurrealDB: Ok
[22/04/2026, 21:27:57] Jordan: I might just stay back at my office to take the calls
[22/04/2026, 21:28:04] Desmond SurrealDB: Works either way let’s just do 10 min calls as well to explain ideas if we want to have them
[22/04/2026, 21:28:14] Desmond SurrealDB: I can organise the calls if you want some help
[22/04/2026, 21:28:17] Jordan: if we need a spot to work ive got a wework in Barbican I can get us into lol
[22/04/2026, 21:28:22] Jordan: depends if they shut
[22/04/2026, 21:28:22] Desmond SurrealDB: Oh great
[22/04/2026, 21:28:28] Desmond SurrealDB: I’m in London tomorrow anyways
[22/04/2026, 21:28:35] Jordan: can book us an office, 24hours
[22/04/2026, 21:28:55] Jordan: nice, until the weekend?
[22/04/2026, 21:29:03] Jordan: or just during the day
[22/04/2026, 21:29:27] Desmond SurrealDB: Just the day but I can come in again on Friday probably I live Wimbledon it’s pretty close
[22/04/2026, 21:29:58] Jordan: ah nice, thought youre living in Cambridge
[22/04/2026, 21:29:58] Desmond SurrealDB: There are tube strikes tomorrow ugh
[22/04/2026, 21:30:15] Desmond SurrealDB: Not yet I’m there during the weeks of term but weekends and holidays hope
[22/04/2026, 21:30:17] Jordan: Ah damn
[22/04/2026, 21:30:19] Desmond SurrealDB: Nope
[22/04/2026, 21:30:47] Desmond SurrealDB: I’ll make it in somehow anyways we can meet tomorrow afternoon a bit if you like or in the evening 6pm also
[22/04/2026, 21:31:38] Jordan: yeah I’ll be a bit busy in the afternoon but I’ll be at the wework
[22/04/2026, 21:31:53] Jordan: if you’re around after 6pm we can meet
[22/04/2026, 21:32:03] Desmond SurrealDB: Sure let’s do that
[22/04/2026, 21:35:57] Jordan: what are you doing on Friday?
[22/04/2026, 21:36:25] Jordan: could get a head start? might give us time to demo and get some traction
[22/04/2026, 21:37:17] Desmond SurrealDB: Apart from the early morning I’m free, can work on the hack should be good to get a head start
[22/04/2026, 21:38:46] Jordan: yeah sounds good. can book you an office in my wework for the day if you want
[22/04/2026, 21:39:07] Jordan: I’ll have work during the day but I’ll be able to multi-task
[22/04/2026, 21:39:09] Desmond SurrealDB: Sounds good it’s easier if we’re working in the same room
[22/04/2026, 21:39:24] Jordan: will try and strip a minimal working harness with some long running agents
[22/04/2026, 21:39:30] Desmond SurrealDB: Ok
‎[22/04/2026, 21:40:49] Jordan: gonna probe into this guy some more ‎image omitted
[22/04/2026, 21:41:44] Desmond SurrealDB: Ok let me know if you want me to text anybody to organise a call tomorrow/probe more
[22/04/2026, 21:43:07] Jordan: yeah ive got a few people on the pipeline but none look like a great fit so far tbh
[22/04/2026, 21:43:30] Desmond SurrealDB: Ok I can send another message in the chat
[22/04/2026, 21:44:15] Desmond SurrealDB: ?
[22/04/2026, 21:45:00] Jordan: yeah can do. might fare better luck banking on us two - and vetting a third on the day
[22/04/2026, 21:45:04] Jordan: but doesnt hurt
[22/04/2026, 23:52:21] Desmond SurrealDB: Nice to meet you, I'm Rodrigo and my skill is basically full stack although there other bits in it, happy to chat through it
In terms of agent harness, I've been working with it for my dev workflow
[22/04/2026, 23:52:21] Desmond SurrealDB: https://www.linkedin.com/in/rodrigo-mancini/
[22/04/2026, 23:52:21] Desmond SurrealDB: 7 10 ish works for me
[22/04/2026, 23:52:21] Desmond SurrealDB: 5:30 as well
[23/04/2026, 07:38:25] Jordan: Yes could be good
[23/04/2026, 07:38:36] Jordan: We need someone who’s good at ingesting and stitching existing tooling together
[23/04/2026, 07:39:07] Desmond SurrealDB: We have a few calls to take tonight we can decided
[23/04/2026, 07:39:11] Jordan: I.e we know what we want, and all render, devin, pydantic logfire and mubit are canonical to what we’re building
[23/04/2026, 18:01:12] Desmond SurrealDB: Hey where are you?
[23/04/2026, 18:05:47] Desmond SurrealDB: ‎Missed voice call, ‎Tap to call back
[23/04/2026, 18:30:01] Jordan: Hey dude
[23/04/2026, 18:30:02] Jordan: ‎Voice call, ‎No answer
[23/04/2026, 18:30:06] Jordan: ‎Voice call, ‎No answer
[23/04/2026, 18:30:08] Desmond SurrealDB: ‎Silenced voice call, ‎Focus mode
[23/04/2026, 18:30:14] Jordan: ‎Voice call, ‎No answer
[23/04/2026, 18:30:20] Jordan: Can’t call
[23/04/2026, 18:30:21] Desmond SurrealDB: ‎Video call, ‎6 min
[23/04/2026, 18:48:31] Desmond SurrealDB: ask on what customer facing he's built
[23/04/2026, 18:52:52] Desmond SurrealDB: we'll get back to him and talk first to others
[23/04/2026, 18:57:12] Desmond SurrealDB: lets move on/ ask him about harnesses
[23/04/2026, 18:58:07] Desmond SurrealDB: shipped?
[23/04/2026, 19:01:37] Jordan: ‎Voice call, ‎No answer
[23/04/2026, 19:01:41] Jordan: ‎Video call, ‎No answer
[23/04/2026, 19:01:42] Desmond SurrealDB: ‎Missed voice call, ‎Tap to call back
[23/04/2026, 19:01:51] Desmond SurrealDB: ‎Voice call, ‎6 min
[23/04/2026, 19:14:22] Desmond SurrealDB: hey are you on tge call
[23/04/2026, 19:25:49] Jordan: ‎Voice call, ‎No answer
[23/04/2026, 19:25:52] Jordan: ‎Voice call, ‎No answer
[23/04/2026, 19:25:59] Jordan: Youre on dnd
[23/04/2026, 19:25:58] Desmond SurrealDB: ‎Voice call, ‎2 min
[23/04/2026, 19:48:16] Desmond SurrealDB: ‎Voice call, ‎2 min
[23/04/2026, 20:13:34] Desmond SurrealDB: ‎Video call, ‎10 min
[23/04/2026, 21:18:23] Jordan: We forgot to call one more person haha - they just messaged me
[23/04/2026, 21:19:35] Jordan: We’ll just stick with the team we’ve currently got though
[23/04/2026, 21:22:02] Desmond SurrealDB: Yep
[23/04/2026, 21:26:56] Jordan: Debating for a long time
[23/04/2026, 21:26:58] Jordan: Nice touch
[23/04/2026, 22:21:08] Jordan: There were actually some cracked engineers on the spreadsheet
[23/04/2026, 22:21:29] Desmond SurrealDB: Oh
[23/04/2026, 22:21:46] Desmond SurrealDB: Really…
[23/04/2026, 22:22:26] Jordan: Yeah, all FE/Full-Stack with AI background and lots of enterprise / start-up experience building agents
[23/04/2026, 22:22:39] Jordan: Oh well lol
[23/04/2026, 22:22:47] Desmond SurrealDB: There’s 6 people there
[23/04/2026, 22:23:11] Jordan: If they didn’t reach out to us then they probably found a team or might not have been interested
[23/04/2026, 22:23:24] Jordan: Yeah I checked their profiles
[23/04/2026, 22:23:28] Desmond SurrealDB: Ok
[23/04/2026, 22:23:51] Desmond SurrealDB: Well what can we do about it, reach out to them?… 🤣🤣
[23/04/2026, 22:24:03] Jordan: 😂😂
[23/04/2026, 22:24:26] Jordan: I mean
[23/04/2026, 22:24:36] Jordan: We can gauge if it’s a fit with David tomorrow
[23/04/2026, 22:24:45] Jordan: And reach out if it goes catastrophically wrong
[23/04/2026, 22:24:48] Desmond SurrealDB: We can do another call
[23/04/2026, 22:24:57] Desmond SurrealDB: With your top choice from the doc
[23/04/2026, 22:25:09] Desmond SurrealDB: We’re fickle
[23/04/2026, 22:25:22] Desmond SurrealDB: (I’m kidding
[23/04/2026, 22:25:41] Jordan: Haha it would be pretty harsh
[23/04/2026, 22:25:46] Jordan: But tbf it’s still a day from the hack itself so I think it’s fair if by then we realise there’s not a real fit
[23/04/2026, 22:25:56] Jordan: But I think only if there’s really no synergy
[23/04/2026, 22:26:05] Desmond SurrealDB: Yep sounds good agreed
[23/04/2026, 22:26:20] Jordan: If he’s got the spirit and eager then great
[23/04/2026, 22:26:27] Jordan: He’s been to a fair few hacks too
[23/04/2026, 22:26:36] Jordan: Won top 3 in about 7-8 I think
[23/04/2026, 22:27:14] Desmond SurrealDB: I think if we work well he’ll be good he’s not like super visionary he likes his docs
[23/04/2026, 22:27:21] Jordan: Maybe worth reaching out to the list anyway
[23/04/2026, 22:27:21] Desmond SurrealDB: That’s what we want
[23/04/2026, 22:27:23] Jordan: Just to gauge
[23/04/2026, 22:27:30] Desmond SurrealDB: Go for it 😅
[23/04/2026, 23:11:37] Jordan: Hey
[23/04/2026, 23:11:42] Jordan: Been thinking more about the pitch
[23/04/2026, 23:11:56] Jordan: The internet of intelligence idea has been on my mind a lot
[23/04/2026, 23:12:06] Jordan: I think it could be a hackathon winner
[23/04/2026, 23:12:12] Desmond SurrealDB: That’s why I mentioned it
[23/04/2026, 23:12:16] Jordan: But we’ll do it through graph rag
[23/04/2026, 23:12:21] Desmond SurrealDB: IoA is very cool
[23/04/2026, 23:12:28] Jordan: It makes our idea suddenly enterprise scalable
[23/04/2026, 23:12:28] Desmond SurrealDB: We don’t necessarily have to
[23/04/2026, 23:12:47] Desmond SurrealDB: But yes we should incorporate an internet of intelligence/agents into the pitch
[23/04/2026, 23:13:03] Desmond SurrealDB: This is equivalent to building a search engine
[23/04/2026, 23:13:15] Jordan: It’s the idea that when you onboard, you store your slack channels etc. to build your memory network of entities, activity, etc.
[23/04/2026, 23:13:46] Jordan: Then when your colleague onboards, they’ll already have an entity node in the ontology, but they can begin expanding and populating - but they don’t have to start from zero either
[23/04/2026, 23:14:11] Jordan: They’ll enrich with any missing/extra data from their side, DMs, etc.
[23/04/2026, 23:14:17] Desmond SurrealDB: Yes exactly decentralised intelligence and playbooks for any agent from any source
[23/04/2026, 23:14:38] Jordan: When you query, you leverage your own memory - but also the herd’s learnings and intelligence through ragging the graph for similar profiles
[23/04/2026, 23:14:46] Jordan: Other entities working on similar problems
[23/04/2026, 23:14:47] Jordan: etc.
[23/04/2026, 23:15:10] Desmond SurrealDB: Yep, if we get the main product working tomorrow with just local memory
[23/04/2026, 23:15:25] Desmond SurrealDB: On Saturday you can do tuning and I can build a global memory internet
[23/04/2026, 23:15:34] Jordan: Meaning intelligence scales with enterprise. It’s probably a better play than going for B-C stance but still going for graph intelligence
[23/04/2026, 23:15:37] Jordan: Because privacy
[23/04/2026, 23:15:46] Desmond SurrealDB: Or if you want to integrate the IoA to be more of a feature we start with it as the core tomorrow
[23/04/2026, 23:16:20] Jordan: For now we don’t have to deviate too much from the original plan which is an ontology knowledge graph as a user-scoped memory layer
[23/04/2026, 23:16:21] Jordan: As v0
[23/04/2026, 23:16:44] Jordan: Then build and iterate on that
[23/04/2026, 23:16:50] Desmond SurrealDB: Sounds good
[23/04/2026, 23:17:01] Desmond SurrealDB: We can have the IoA be an aha moment in the pitch
[23/04/2026, 23:17:08] Jordan: Haha yes exactly
[23/04/2026, 23:17:17] Jordan: Basically when we walk through the product itself
[23/04/2026, 23:17:19] Jordan: it’s already impressive
[23/04/2026, 23:17:27] Jordan: but it’s like, cool that’s nice
[23/04/2026, 23:17:35] Jordan: Then we layer this on them
[23/04/2026, 23:17:41] Jordan: IoA feels really novel
[23/04/2026, 23:17:52] Jordan: And utilises graph knowledge really well and naturally I think
[23/04/2026, 23:17:55] Desmond SurrealDB: Yep the only thing we really need to make sure we get right is how we demo all this capability and show it’s validation
[23/04/2026, 23:18:08] Desmond SurrealDB: I think that’s the hard part
[23/04/2026, 23:18:13] Jordan: There are a few things we can benchmark which I’ve been doing with codewords.ai
[23/04/2026, 23:18:21] Jordan: against claude and perplexity
[23/04/2026, 23:21:49] Jordan: Like daily tasks that can be benched.

-> find me the fastest route from a to b -> time
-> find me the latest blogs on x -> recency
-> find me the cheapest flats in x -> monetary
-> find me the best flights from a to b -> mixed
-> find me intel on person X and their background -> research

I think we could get reasonable margins on claude out the box
[23/04/2026, 23:22:49] Jordan: If we can, there’s incentive to use us over general providers. Then the sell is all of this you ask once, and the pattern gets automated and rehashed. Automations and workflows stack into an ecosystem and ontology of intent
[23/04/2026, 23:23:53] Jordan: Composable workflows conjoin, clusters of identity form from different islands of use-cases, i.e corporate, personal, etc.
[23/04/2026, 23:25:09] Jordan: But yeah, I think having codified patterns for doing stuff on the internet that leverages IoA, continual learning in-context - already makes it more capable for general tasks than Claude purely because of it’s tools and playbooks layer
[23/04/2026, 23:25:29] Jordan: I already benched our prod with Claude and Perplexity for these tasks and it’s better and more precise for all of them
[23/04/2026, 23:25:38] Jordan: So we could try to get similar results
[23/04/2026, 23:27:10] Jordan: For tomorrow, our goal is to get the plumbing down. A minimal coding agent on a simple UI interface building services on render infra and composio integrations
[23/04/2026, 23:27:21] Jordan: Mostly objective work
[23/04/2026, 23:27:26] Jordan: With clearly defined goals
[23/04/2026, 23:27:27] Desmond SurrealDB: Ok that sounds like a good plan for validation, process oriented evals is probably best
[23/04/2026, 23:27:48] Desmond SurrealDB: Yep that sounds right, knowledge graph if we have time
[23/04/2026, 23:27:49] Jordan: Then we’ll focus saturday on tuning and shaping, tooling, etc.
[23/04/2026, 23:27:57] Jordan: Yeah can be a minimal memory implementation to start
[23/04/2026, 23:28:04] Jordan: Like mubit out the box + a simple graph
[23/04/2026, 23:28:08] Desmond SurrealDB: Cool
[23/04/2026, 23:28:16] Jordan: then we can base how we shape this on Sat by chatting to sponsors
[23/04/2026, 23:28:34] Jordan: Saturday we should really utilise the afternoon talking to sponsors as deeply as possible
[23/04/2026, 23:28:44] Jordan: Since we’re using all of them
[23/04/2026, 23:28:55] Desmond SurrealDB: Yes I joked about fde but really it’s a crucial win criteria
[23/04/2026, 23:29:30] Jordan: Also owe my wins to this; it excites them about what you’re building so kudos and rapport for judgement day, but also it really helps to understand how to use their product well and get insights on their experience working with clients ‎<This message was edited>
[23/04/2026, 23:30:44] Jordan: I should probably message the gc instead tbh
[23/04/2026, 23:30:48] Jordan: Will paste this over tmr
[23/04/2026, 23:31:14] Desmond SurrealDB: 👌
[23/04/2026, 23:31:56] Jordan: Was lying in bed but got geeked about the IoA graph for enterprise
[23/04/2026, 23:32:00] Jordan: Gonna try and get some shut eye
[23/04/2026, 23:32:06] Jordan: Chat tmr, cya
[24/04/2026, 10:00:19] Desmond SurrealDB: Do you think we’ll need to overnight both today and tomorrow?
[24/04/2026, 10:11:03] Jordan: I think tonight, no
[24/04/2026, 10:11:07] Jordan: But tomorrow, possibly
[24/04/2026, 10:11:19] Jordan: Probably*
[24/04/2026, 10:37:48] Desmond SurrealDB: I might do more tonight and get ok rest for pitch day
[24/04/2026, 10:50:55] Jordan: yeah let’s meet up later and we’ll figure out the sched
[24/04/2026, 10:52:03] Jordan: if things move productively and there’s value in going overnight, i could back it. I usually peak towards the end personally and crash the day after a night without sleep, but we’ll feel it out
[24/04/2026, 11:11:35] Desmond SurrealDB: Sounds good
[24/04/2026, 11:11:42] Desmond SurrealDB: We don’t all have to do the same thing
[24/04/2026, 11:14:31] Desmond SurrealDB: You probably don’t have to send one
[24/04/2026, 11:14:38] Desmond SurrealDB: Video
[24/04/2026, 11:18:29] Jordan: I already sent one
[24/04/2026, 11:18:33] Jordan: It was like 15s
[24/04/2026, 12:03:52] Jordan: yo
[24/04/2026, 12:03:59] Jordan: do you know what david means by his last msg lol
[24/04/2026, 12:11:53] Jordan: damn we got to this guy too late
[24/04/2026, 12:11:57] Jordan: probably the best fit on the spreadsheet
‎[24/04/2026, 12:12:16] Jordan: ‎image omitted
[24/04/2026, 12:12:27] Jordan: https://www.linkedin.com/in/rakhmanovartem/
[24/04/2026, 12:14:31] Desmond SurrealDB: Which guy
[24/04/2026, 12:15:00] Desmond SurrealDB: No probably he was going to do solo but he’s in our team?
[24/04/2026, 12:15:13] Desmond SurrealDB: If there’s a cracked guy we missed we should do a call
[24/04/2026, 12:16:38] Desmond SurrealDB: Are we going to work from home overnight Saturday, I’m just thinking if I want to have a figure skating lesson in the morning 😅😅
[24/04/2026, 12:18:13] Jordan: Alyssa Liu in the house
[24/04/2026, 12:18:26] Jordan: Depends if it’s freezing outside
[24/04/2026, 12:19:06] Jordan: Ah yeah realised he was responding to the video message
[24/04/2026, 12:20:20] Jordan: He’s got FE experience and lots of Agent experience too. ‘- AI workflows and micro-agents to extend operational capacity without additional hiring’
[24/04/2026, 12:20:38] Jordan: I called our product ‘microbots’ in the video after big hero 6 lol
[24/04/2026, 12:21:09] Desmond SurrealDB: Haha you make the call
[24/04/2026, 12:21:57] Jordan: I’ll see if he’s willing to ditch his mate
‎[24/04/2026, 12:57:10] Jordan: ‎image omitted
[24/04/2026, 13:14:48] Jordan: Gonna be a bit stacked for work - got a deploy to baby
[24/04/2026, 13:14:56] Jordan: Do you mind taking over comms with Artem?
[24/04/2026, 14:02:55] Desmond SurrealDB: Ok
[24/04/2026, 14:03:01] Desmond SurrealDB: Heading to the barbican now
[24/04/2026, 14:03:30] Jordan: Did you see my dms in the gc
[24/04/2026, 14:03:32] Desmond SurrealDB: Do you want him instead?
[24/04/2026, 14:03:54] Jordan: Let’s talk to him around 4.30/5ish at Barbican
[24/04/2026, 14:04:01] Jordan: Before he meets the other guy
[24/04/2026, 14:04:08] Desmond SurrealDB: ‎Voice call, ‎3 min
‎[24/04/2026, 14:34:18] Desmond SurrealDB: ‎image omitted
[24/04/2026, 14:43:35] Jordan: Er we don’t need a third to deploy agents at scale
[24/04/2026, 14:43:57] Jordan: I think FE would be a fantastic addition with some agent experience because we’re missing that
[24/04/2026, 14:44:12] Jordan: I can handle the agent plumbing
[24/04/2026, 14:44:17] Desmond SurrealDB: Ok
[24/04/2026, 14:44:51] Desmond SurrealDB: Will forward to him
[24/04/2026, 14:45:09] Jordan: I think we need someone with a different perspective from us to refresh the pitch and sell the experience
[24/04/2026, 14:45:32] Desmond SurrealDB: Got it
[24/04/2026, 15:40:45] Jordan: I might not make 4.30
[24/04/2026, 15:40:54] Desmond SurrealDB: 4:45
[24/04/2026, 15:40:57] Jordan: Whats he saying
[24/04/2026, 15:41:06] Jordan: I can take it remotely
[24/04/2026, 15:41:05] Desmond SurrealDB: he’s read your forwards
[24/04/2026, 15:41:08] Jordan: Or on the phone
[24/04/2026, 15:41:20] Desmond SurrealDB: he said he’ll still come talk probably
[24/04/2026, 15:41:31] Desmond SurrealDB: are you going to come in though
[24/04/2026, 15:41:54] Jordan: I’ll come but idk if I’ll make it for 4.45 so I’ll have to jump on a call
[24/04/2026, 15:42:37] Desmond SurrealDB: ok,
[24/04/2026, 15:47:04] Desmond SurrealDB: 16:45 at moorgate, do you want to text him say you’re coming in but on a train taking the call or something
[24/04/2026, 15:52:37] Desmond SurrealDB: do you have a guest pass for me at we work?
[24/04/2026, 15:57:54] Jordan: I think I have to let you in
[24/04/2026, 15:57:58] Jordan: Let me chat with him
[24/04/2026, 15:58:15] Desmond SurrealDB: you should
[24/04/2026, 15:58:26] Desmond SurrealDB: can you get on a train now
[24/04/2026, 15:58:28] Desmond SurrealDB: ?
[24/04/2026, 15:59:14] Jordan: I’m on a call rn - earliest I can get to you is like 5
[24/04/2026, 15:59:45] Desmond SurrealDB: ok
[24/04/2026, 15:59:55] Desmond SurrealDB: did you tell him your situation
[24/04/2026, 16:20:39] Jordan: yeah
[24/04/2026, 16:20:41] Jordan: just called
[24/04/2026, 16:20:46] Jordan: eta 5pm
[24/04/2026, 16:20:55] Desmond SurrealDB: Ok
[24/04/2026, 16:26:56] Jordan: ‎Voice call, ‎No answer
[24/04/2026, 16:28:12] Desmond SurrealDB: ‎Voice call, ‎18 min
[24/04/2026, 16:57:58] Desmond SurrealDB: We’re in Finsbury circus
[24/04/2026, 20:00:19] Jordan: ‎Voice call, ‎4 sec
[24/04/2026, 20:23:18] Desmond SurrealDB: https://events.ycombinator.com/startup-school-2026?referrer=2c5f1594-b1d8-4d99-b2b8-4673def29080&utm_campaign=meetup&utm_source=email
