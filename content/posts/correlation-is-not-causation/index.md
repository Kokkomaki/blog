+++
title = "Correlation is not Causation"
date = "2026-03-21T00:00:00+02:00"
draft = false
+++

I couldn't think of a better title, I am sorry. It's quite cliche, certainly. Anyway, I think correlation is witty. In my bachelor studies I studied a lot of advanced statistics and theory. Professors and teachers tried to nail the slogan 'correlation is not causation' to our brain. 

Granted, correlation is one of the best things we have. Correlation gives even just faint direction when all else is dark and unknown. However, it is not at all a reliable indicator of anything *by itself*. So when I hear something is correlated, I cringe. Almost immediately I grow distrusting.

{{< center >}}—{{< /center >}}

Therefore, if "A & B are correlated" with r = 0.3 we could say:

* A causes B (direct causation)
* B causes A (reverse causation)
* A causes B and B causes A (bidirectional / cyclic)
* A causes C which causes B (mediation / indirect causation)
* A & B are both consequences of a common cause C, but don't cause each other (confounding)
* A and B both cause C, and we are conditioning on C — inducing a spurious correlation between A and B that doesn't really exist (collider bias / selection artifact)
* A and B are the same thing, measured at different levels (tautological / measurement artifact)
* There is no connection between A and B; the correlation is a mere coincidence (spurious correlation)

&nbsp;

```goat
1. Direct                      2. Reverse                     3. Bidirectional

   A -----------> B               A <------------ B              A <-----------> B


4. Mediation                   5. Confounding                 6. Collider (conditioning on C)

                                          C                        A           B
   A ------> C ------> B                / \                         \         /
                                       /   \                         \       /
                                      v     v                         v     v
    
                                      A     B                            C


7. Tautological                8. Coincidence (spurious correlation)

   A  ==  B                       A             B
  (same construct,
   diff. measurement)
```
&nbsp;

So, it's no so clear as to what correlation implies here. In everyday language, when someone says that two things are associated with each other or that something is caused by something (when in reality we are merely implying a correlation, alas folk language can be confusing), means very little. 