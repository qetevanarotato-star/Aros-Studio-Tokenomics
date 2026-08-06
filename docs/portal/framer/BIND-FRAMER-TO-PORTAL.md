# Framer bound to live portal

Your Framer chrome (logo, menu, titles) stays.  
Full portal process runs inside **AstPortalFrame** (`?embed=1`).

## Live URL (session)

```
https://ahead-fibre-adjacent-rock.trycloudflare.com
```

## Pages

| Framer page | Path in frame | Process |
|-------------|---------------|---------|
| Cabinet | `/login` then inside → dashboard | Verification / login |
| Tokenization | `/tokenization` | Evidence → sign → start → **certificate** |
| NodeChain | `/nodechain` | Live journal |

## Start (Mac)

```bash
cd ~/Aros-Studio-Tokenomics
bash scripts/home-up.sh
bash scripts/home-tunnel.sh
cat .home-run/public-url.txt
```

If tunnel URL changes, set **Portal URL** on each AstPortalFrame instance in Framer.

## Login

- pilot / pilot  
- Language: ru / ka in frame props or `?lang=`

## Flow for guest

1. Open your published Framer site  
2. Menu → Cabinet → sign in  
3. Menu → Tokenization → full wizard → certificate  
4. Menu → NodeChain → journal  

Mac must stay awake while demos run.
