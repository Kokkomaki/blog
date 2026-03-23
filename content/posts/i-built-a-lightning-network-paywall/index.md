+++
title = "I built a Lightning Network paywall"
date = "2026-03-19T15:00:00+02:00"
draft = false
+++

![generic lightning](/images/lightning.jpg)

***Updated. 20th, March.** I believe a shrewd hacker somehow redirected the Lightning Network invoices to their wallet, making them just a few cents richer, and me more wiser. Quite fun, actually! Not my first rodeo. It makes a great story. I also made the paywal just for a specific subsection, instead of the whole article. I suppose not everyone has a LN wallet in their computers. Enjoy!*

Obviously this post was going to be ~~paywalled~~ with a generic lightning photo. What did you expect? ~~A free article? You have to pay me one cent to access the article. Mwuahahah! I'll make you poor. I hope I am not being too greedy? Before you pay, you have the chance to read this teaser of what is to come.~~ The article is more or less my story on how I built the paywall. It's a proof of concept, and ~~quite~~ a functioning version at that, too. 

I built ~~the opacity-gradient and the UX~~, a connection to Lightning Network (LN) wallet via REST API, and an extension for both mobile and desktop (WebLN). These extensions make paying with LN wallets more easier, rather than just scanning the QR code. I also had to use a Deno Worker to make the paywall an actual paywall and not just a facade. Content is fetched from a private github repo.

What's amazing is that I built all this in *one, fricken'*, day. Well, so I thought, haha. Actually it took ~~four~~ seven days after bugs and improvements. You know, the usual. The plot twist: I was babysitting Claude Code the Clanker, which (who?) made it for me. I gave it orders (gentle directions!) and voilà. To be honest, you don't even need to pay and read the rest of the article unless you are interested in the technical execution. Bon voyage!

## The Paywall

You can try the "paywall" here. You might get nothing, you might get something. It's for fun. 

{{< paywall sats="15" >}}

{{< /paywall >}}

## The Idea

The idea came after I bought a subscription and tried Claude Code, and witnessed its power. I figured: this is my time to shine and really do what I've always wanted with coding. I'm an avid "bitcoiner" and a writer, so I figured a Bitcoin paywall would be a great, obvious hobby project. 

First, the paywall *is* and *is not* a Bitcoin paywall. It's a nuanced difference. For one, it doesn't receive bitcoin through the main chain, or as we call it, on-chain. So, don't send me your bitcoin from your bitcoin wallet. Most wallets these days can recognise if the address is incorrect.

Rather, it is off-chain and receives bitcoin through the LN. I hope one day we can linguistically say Bitcoin as merely LN, or that LN is so abstracted that we don't even pay attention. LN is going to be the place where the majority of the transactions will occur in the future. LN enables micro-transactions, such as sending a one cent possible. With Bitcoin as we used to know, it's not feasible. Furthermore, LN also makes the transactions more private, however, with its own nuances and vectors. 

I also tried to install Cashu to the paywall, which utilises LN. Cashu abstracts Bitcoin and LN even more. Cashu functions essentially like cash: it's as private and instant as it goes. However, the drawback is that you need to trust more on the entity who "minted" (read, created) the e-cash. Regardless, the technology is still in its infancy, and after implementing and trying it, I decided it wasn't worth to keep it.  

## The Stack

**Figure 1. Process Diagram**

```goat
┌───────┐            ┌──────┐      ┌──────┐┌─────────┐┌──────┐
│Browser│            │Worker│      │Coinos││Lightning││GitHub│
└───┬───┘            └──┬───┘      └──┬───┘└────┬────┘└──┬───┘
    │                   │             │         │        │    
    │GET /create-invoice│             │         │        │    
    │──────────────────>│             │         │        │    
    │                   │             │         │        │    
    │                   │POST /invoice│         │        │    
    │                   │────────────>│         │        │    
    │                   │             │         │        │    
    │                   │hash + bolt11│         │        │    
    │                   │<────────────│         │        │    
    │                   │             │         │        │    
    │   hash + bolt11   │             │         │        │    
    │<──────────────────│             │         │        │    
    │                   │             │         │        │    
    │              pay (QR/webln)     │         │        │    
    │──────────────────────────────────────────>│        │    
    │                   │             │         │        │    
    │                   │             │ settle  │        │    
    │                   │             │<────────│        │    
    │                   │             │         │        │    
    │GET /check-invoice │             │         │        │    
    │──────────────────>│             │         │        │    
    │                   │             │         │        │    
    │                   │GET /invoice │         │        │    
    │                   │────────────>│         │        │    
    │                   │             │         │        │    
    │                   │received>=amt│         │        │    
    │                   │<────────────│         │        │    
    │                   │             │         │        │    
    │   paid + token    │             │         │        │    
    │<──────────────────│             │         │        │    
    │                   │             │         │        │    
    │GET /content?token=│             │         │        │    
    │──────────────────>│             │         │        │    
    │                   │             │         │        │    
    │                   │         fetch slug.md │        │    
    │                   │───────────────────────────────>│    
    │                   │             │         │        │    
    │                   │            markdown   │        │    
    │                   │<───────────────────────────────│    
    │                   │             │         │        │    
    │      content      │             │         │        │    
    │<──────────────────│             │         │        │    
┌───┴───┐            ┌──┴───┐      ┌──┴───┐┌────┴────┐┌──┴───┐
│Browser│            │Worker│      │Coinos││Lightning││GitHub│
└───────┘            └──────┘      └──────┘└─────────┘└──────┘

```

*Hugo* is the static site generator that renders this blog. Hugo takes my Markdown content, i.e. the blog posts, templates, layouts, and assets, and combines them to produce a complete static website that you see on the browsers. I don't have a server or database and nothing is dynamic. The paywall is implemented as a Hugo shortcode, which means I need to write a small template fragment.

However, two questions arise. One, how do I hide the content *visually*, and two, how do I hide the content *technically*? ~~To hide the content visually, I added a visual gate. It's a `div` with `max-height`, a CSS gradient fading the teaser text to the background colour, and an overlay pinned to the bottom with the unlock button. The gradient had to feel natural, readable enough at the top that the reader understands there is real content there, obscured enough at the bottom that they feel the incompleteness.~~ 

Technically, if I had let it be as is, then someone could read the blog post from the said HTML code by inspecting the website code. Yet another way to find out the post content without paying is through GitHub source, Kokkomaki/blog. There's nothing wrong with that, but it beats the purpose and proof of concept of an LN paywall. 

Therefore, I used *Deno Deploy*. These little workers live at a serverless platform where I write small functions like redirecting URLs or fetching data. The workers are distributed globally, so they can execute commands close to the user. This means reduced latency.

At first I used *Cloudflare Workers*. However, they didn't work so well with *Coinos*, because of their Cloudflare anti-bot detection. This resulted in an [error 1106](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1006/): Your IP address has been banned. Ironic. Cloudflare Workers tried to access Coinos, but they were flagged as bots, by Cloudflare itself. Sigh... I was forced to change the workers from Cloudflare to Deno, and that was a slight pain in the butt for one day. Lots of bugs and troubleshooting and simple tweaks. Life of a code wizard, huh? 

I've put my Deno workers to handle four things: create Lightning invoices, check whether they have been paid, issue unlock tokens, and serve gated content. This is free.

Then the question is that where is the content, exactly? Well, the teaser content plus some more under the gradient live in GitHub. The rest of the content is gated at a Github private repository. 

Then, certainly we need to connect to a (hosted) Lightning Network wallet. For this I chose to use *coinos.io*. There's no particular reason why I chose them. They just happened to be enough for the shenanigans. However, I did research alternatives because of the whole IP ban. I could've stayed with Cloudflare and use other LN REST API, but there weren't many of them for this hobby use. Some required a 1% fee, other KYC, and many required a self-hosted LN node. Well, maybe (probably) I will do it again, but with a self-hosted LN node.   

So, this LN wallet by Coinos has a REST API working behind the scene. And to make this all work smoothly for the user, I installed WebLN. Therefore, when `window.webln` is present, the paywall skips the QR entirely and sends the payment directly through the extension.

## The Hack

So apparently right after I published the article, someone redirected the LN invoice address. This meant that all the payments didn't go to my address but the hacker's. I am still not *exactly* sure what happened, but I have a hunch. I recreated the worker and rotated the secret token values. Luckily the hacker got only cents. I also made the article open for everyone. 

## The Workflow

I built the paywall using Claude Code, Anthropic's CLI. The workflow was not "ask the AI to write the code", rather it was closer to a directed collaboration with a "strong junior engineer" who typed very fast. 

The meaningful work was in structuring the tasks: research first, then plan, then implement, then revise, then finalise. I had a vision what I wanted to build beforehand, so the execution was smooth. Still, I did have a lot of back and forth, deviating from the workflow. I need to learn to be more disciplined with this. Lastly, I did a cleanup and security audit. [Which failed *majestically!*]

This taught me a lot about code, mindset, the Lightning Network, security practises, and prompting. I'm quite proud to present you this paywall, if you made it this far. 

Here's my workflow with Claude Code.

**Figure 2. Claude Code Workflow.**
```goat
╔══════════════════════════════════════════════════════════════════╗
║              CLAUDE CODE WORKFLOW                                ║
╚══════════════════════════════════════════════════════════════════╝

  ┌─────────────┐
  │  PHASE 1    │
  │  RESEARCH   │  "Read this deeply, understand all its
  │             │   nuances, write findings to research.md"
  └──────┬──────┘
         │
         ▼
  ┌─────────────┐
  │  PHASE 2    │
  │  PLANNING   │  "Write a detailed plan.md"
  └──────┬──────┘
         │
         ▼
  ┌──────────────────────────────────────────────────┐
  │               ANNOTATION CYCLE                   │
  │                                                  │
  │   Claude writes plan.md                          │
  │         │                                        │
  │         ▼                                        │
  │   You review in editor                           │
  │         │                                        │
  │         ▼                                        │
  │   You add inline notes ("I dont like this,       │
  │                  do this or that")               │
  │         │                                        │
  │         ▼                                        │
  │   "I added notes — address them, don't           │
  │    implement yet"                                │
  │         │                                        │
  │         ▼                                        │
  │   Claude updates plan ──────────────────┐        │
  │         │                               │        │
  │         ▼                        repeat │        │
  │   Satisfied? ──── No ───────────────────┘        │
  │         │                                        │
  │        Yes                                       │
  │         │                                        │
  │         ▼                                        │
  │   "Add a todo list — don't implement"            │
  └──────────────────────┬───────────────────────────┘
                         │
                         ▼
  ┌─────────────┐
  │  PHASE 3    │  "Implement it all. Mark tasks done in
  │ IMPLEMENT   │   plan.md. 
  └──────┬──────┘
         │
         ▼
  ┌─────────────────────────────────────┐
  │         FEEDBACK LOOP               │
  │                                     │
  │   Claude implements                 │
  │         │                           │
  │         ▼                           │
  │   You review / test                 │
  │         │                           │
  │         ▼                           │
  │   Correct? ── No ── fix ────────┐   │
  │         │       ("wider",       │   │
  │         │        "move it",     │   │
  │         │        "revert +      │   │
  │        Yes        re-scope") ───┘   │
  │         │                           │
  │         ▼                           │
  │       Done ✓                        │
  └─────────────────────────────────────┘
```

