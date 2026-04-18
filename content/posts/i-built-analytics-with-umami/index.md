+++
title = "I built analytics with Umami"
date = "2026-04-18T14:00:00+02:00"
+++

I came across a [blog post](https://blog.orhun.dev/setting-up-this-blog/) by Orhun Parmaksız, where he lays out how he setup his blog. Kind of like how I wrote about [how I updated my blog style and infrastructure]({{< ref "posts/i-updated-my-blog-style-and-infrastructure/index.md" >}}). 

Similarly, he is using a Static Site Generator but named Zola. I almost used it as well, but I didn't find any great starter themes. They were too "terminal" and computer-styled. 

What caught my attention was he's use of a GitHub-powered commenting system, named [utterances](https://utteranc.es/). I thought that was also quite rad. Even cooler, he said he is using an open source analytics, [umami](https://umami.is/), to track who's visited his site, from which device, where, and what were the most popular pages and posts. I've wanted exactly something like this!

So I put my *vibecoder hat* on, and started to work. It was relatively easy to set up. All I needed was to deploy another Deno Worker (like I used for my [Lightning paywall]({{< ref "posts/i-built-a-lightning-network-paywall/index.md" >}})), add an umami API secret key there, and then create a separate .html file for the [analytics]({{< ref "analytics/index.md" >}}) page. I designed the overlay as an ASCII art, and now it renders seamlessly on both mobile and desktop. 

Right now it shows the past 30 days. A year from now, I will extend it to have more intervals, up to "all time". I just think it's nice to share this data for everyone. It's a sweet little extension. 

{{< center >}}· · · ✦ · · ·{{< /center >}}

**{{< center >}}Analytics{{< /center >}}**
{{< analytics >}}
