# Avvio ogni 5 minuti con cron-job.org

Il raccoglitore supporta già l'avvio tramite API (`workflow_dispatch`). Un timer esterno
può usare questa funzione quando la pianificazione nativa di GitHub non parte.
Il download e la pubblicazione rimangono su GitHub Actions; il PC può restare spento.
L'avvio tramite API evita lo scheduler cron di GitHub, ma resta soggetto alla
disponibilità e ai tempi dei runner Actions e della fonte dei prezzi.

La configurazione qui sotto richiede un account personale cron-job.org e un token
GitHub dedicato. La sua attivazione va verificata nella cronologia del servizio.

## 1. Account e token

Registrati su [cron-job.org](https://console.cron-job.org/signup) e conferma l'indirizzo email.
Il servizio offre gratuitamente richieste programmate, anche con metodo POST,
intestazioni e corpo personalizzati: [funzionalità ufficiali](https://cron-job.org/en/).

Su GitHub apri [Fine-grained personal access tokens](https://github.com/settings/personal-access-tokens/new):

- Nome: `price-history-cron`.
- Resource owner: `iamlucaconti`.
- Repository access: **Only select repositories**, solo `price-history`.
- Repository permissions: **Actions: Read and write**. Metadata in lettura è automatico.
- Imposta una scadenza e annota quando rinnovarlo per evitare che il timer smetta di funzionare.

Il token va inserito solo nell'intestazione del job su cron-job.org. Non inserirlo
nel repository, nell'URL o in chat. Non serve accesso in scrittura ai file del repository:
il workflow pubblica i dati con il proprio `GITHUB_TOKEN` temporaneo.

## 2. Crea il job

Nella console cron-job.org crea un cronjob con:

- Titolo: `Price history - ogni 5 minuti`.
- URL: `https://api.github.com/repos/iamlucaconti/price-history/actions/workflows/collect.yml/dispatches`.
- Metodo HTTP: **POST**.
- Fuso orario: **UTC**.
- Frequenza: **ogni 5 minuti** (minuti **0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55**), tutte le ore e tutti i giorni.
- Corpo della richiesta:

```json
{"ref":"main"}
```

Intestazioni della richiesta:

| Nome | Valore |
| --- | --- |
| `Authorization` | `Bearer IL_TUO_TOKEN_GITHUB` |
| `Accept` | `application/vnd.github+json` |
| `Content-Type` | `application/json` |
| `X-GitHub-Api-Version` | `2022-11-28` |
| `User-Agent` | `price-history-cron` |

Sostituisci il segnaposto con il token creato al punto precedente.
Riferimento: [API GitHub per avviare un workflow](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).

## 3. Verifica prima di considerarlo funzionante

1. Esegui il test del job su cron-job.org. Con la versione API sopra GitHub risponde
   normalmente **204**, senza corpo: significa che ha accettato la richiesta.
2. Controlla [le esecuzioni avviate tramite API](https://github.com/iamlucaconti/price-history/actions/workflows/collect.yml?query=event%3Aworkflow_dispatch):
   deve apparire `Collect prices · workflow_dispatch · main` e completarsi con successo,
   incluso `Publish only generated data`.
3. Verifica che `generatedAt` nel [manifesto](https://raw.githubusercontent.com/iamlucaconti/price-history/data/manifest.json)
   sia aggiornato. Più avvii nello stesso intervallo di cinque minuti sostituiscono il punto di quell'intervallo.
4. Attendi uno degli orari configurati e controlla sia la cronologia automatica su
   cron-job.org sia il corrispondente workflow riuscito. Un test manuale riuscito,
   da solo, non verifica la pianificazione automatica.

Gli avvii del timer esterno si chiamano `workflow_dispatch` su GitHub, non `schedule`.
La cronologia su cron-job.org distingue il test manuale dalle richieste programmate.
Se il token scade o viene revocato, aggiornalo nelle intestazioni del job.
