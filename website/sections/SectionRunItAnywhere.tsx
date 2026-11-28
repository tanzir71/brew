// Brew 19:921, translated from Figma NcqNdBhgeg6om2CCZwrYV8.
const imgLead = './assets/figma/43ce0c11102808c5.svg';
const imgLead1 = './assets/figma/cdada4e2862fdcac.svg';
const imgIconBrowser = './assets/figma/b29241ffd37daabc.svg';
const imgIconPlus = './assets/figma/3d4d18508c5dcbb2.svg';
const imgIconX = './assets/figma/30c18bad1e50a02f.svg';
const imgIconServer = './assets/figma/170e29b9c6578de3.svg';
const imgIconCheck = './assets/figma/4d5ffcaf6c991286.svg';
const imgIcon = './assets/figma/c22b9d42079286f5.svg';
const imgIconCloud = './assets/figma/b4bc487bfac1f1fb.svg';
const imgIcon1 = './assets/figma/5473da53b604b591.svg';
const imgIconGlobe = './assets/figma/d329724a36c36504.svg';
const imgIcon2 = './assets/figma/ef5f0be5da22288d.svg';
const imgIconFile = './assets/figma/a555b0b94b8cded1.svg';
const imgIcon3 = './assets/figma/c5a4176d18e06ac8.svg';
const imgIconCheck1 = './assets/figma/beebf3c08b0e9cda.svg';
const imgIconPlus1 = './assets/figma/ddea6d221234c07f.svg';
const imgIconX1 = './assets/figma/ca0a3506d19b141a.svg';

type BadgeProps = {
  className?: string;
  label?: string;
  tone?: 'neutral' | 'accent';
};

function Badge({ className, label = 'Works here', tone = 'neutral' }: BadgeProps) {
  const isAccent = tone === 'accent';
  return (
    <div
      className={
        className ||
        `content-stretch flex gap-[5px] h-[22px] items-center pl-[7px] pr-[8px] relative rounded-[999px] ${isAccent ? String.raw`bg-[var(--brew-accent-soft)]` : String.raw`bg-[var(--brew-bg-subtle)]`}`
      }
      id={isAccent ? 'node-6_50' : 'node-6_47'}
    >
      <div
        className="relative shrink-0 size-[6px]"
        id={isAccent ? 'node-6_51' : 'node-6_48'}
        data-name="Lead"
      >
        <img alt="" className="figma-asset" src={isAccent ? imgLead1 : imgLead} />
      </div>
      {tone === 'neutral' && (
        <p
          className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[12px] text-[color:var(--brew-text-soft)] whitespace-nowrap"
          data-node-id="6:49"
          style={{ fontVariationSettings: '"wdth" 100' }}
        >
          {label}
        </p>
      )}
      {isAccent && (
        <p
          className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[12px] text-[color:var(--brew-accent-default)] whitespace-nowrap"
          data-node-id="6:52"
          style={{ fontVariationSettings: '"wdth" 100' }}
        >
          {label}
        </p>
      )}
    </div>
  );
}

export default function SectionRunItAnywhere() {
  return (
    <div
      className="content-stretch flex flex-col items-center pt-[160px] relative size-full"
      data-node-id="19:921"
      data-name="Section · Run it anywhere"
    >
      <p
        className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[13px] text-[color:var(--brew-text-muted)] whitespace-nowrap"
        data-node-id="19:922"
        style={{ fontVariationSettings: '"wdth" 100' }}
      >
        Run it anywhere
      </p>
      <div className="h-[14px] relative shrink-0 w-[10px]" data-node-id="19:923" data-name="Gap" />
      <p
        className="[word-break:break-word] font-[family-name:var(--brew-font-reading)] font-normal leading-[48px] relative shrink-0 text-[44px] text-[color:var(--brew-text-primary)] text-center tracking-[-0.88px] w-[900px]"
        data-node-id="19:924"
      >
        One codebase. Five places to run it.
      </p>
      <div className="h-[16px] relative shrink-0 w-[10px]" data-node-id="19:925" data-name="Gap" />
      <p
        className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[22px] relative shrink-0 text-[15px] text-[color:var(--brew-text-soft)] text-center w-[620px]"
        data-node-id="19:926"
        style={{ fontVariationSettings: '"wdth" 100' }}
      >
        Start in your browser in ten seconds. Move to your own server or Cloudflare when you want
        background fetching and inbound mail. Your data goes with you as one file.
      </p>
      <div className="h-[48px] relative shrink-0 w-[10px]" data-node-id="19:927" data-name="Gap" />
      <div
        className="content-stretch flex gap-[16px] items-start overflow-clip relative shrink-0"
        data-node-id="19:931"
        data-name="Modes"
      >
        <div
          className="bg-[var(--brew-bg-surface)] border border-[var(--brew-border-default)] border-solid content-stretch flex flex-col gap-[14px] h-[439px] items-start overflow-clip p-[20px] relative rounded-[14px] shrink-0 w-[256px]"
          data-node-id="19:932"
          data-name="Mode card · This browser"
        >
          <div
            className="content-stretch flex items-center overflow-clip relative shrink-0 w-full"
            data-node-id="19:933"
            data-name="Frame"
          >
            <div
              className="bg-[var(--brew-bg-subtle)] content-stretch flex items-center justify-center overflow-clip relative rounded-[10px] shrink-0 size-[40px]"
              data-node-id="19:934"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[20px]"
                data-node-id="19:935"
                data-name="Icon/browser"
              >
                <img alt="" className="figma-asset" src={imgIconBrowser} />
              </div>
            </div>
            <div
              className="flex-[1_0_0] h-px min-w-px relative"
              data-node-id="19:936"
              data-name="Spacer"
            />
          </div>
          <div
            className="[word-break:break-word] content-stretch flex flex-col gap-[6px] items-start overflow-clip relative shrink-0 w-full"
            data-node-id="19:937"
            data-name="Frame"
          >
            <p
              className="font-[family-name:var(--brew-font-ui)] font-semibold leading-[22px] relative shrink-0 text-[17px] text-[color:var(--brew-text-primary)] tracking-[-0.17px] w-full"
              data-node-id="19:938"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              This browser
            </p>
            <p
              className="font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] relative shrink-0 text-[13px] text-[color:var(--brew-text-soft)] w-full"
              data-node-id="19:939"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              Nothing to install. Your data stays in this browser.
            </p>
          </div>
          <div
            className="bg-[var(--brew-border-default)] h-px relative shrink-0 w-full"
            data-node-id="19:940"
            data-name="Rule"
          />
          <div
            className="content-stretch flex flex-col gap-[9px] items-start overflow-clip relative shrink-0 w-full"
            data-node-id="19:941"
            data-name="Capabilities"
          >
            <div
              className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:942"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[14px]"
                data-node-id="19:943"
                data-name="Icon/plus"
              >
                <img alt="" className="figma-asset" src={imgIconPlus} />
              </div>
              <p
                className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
                data-node-id="19:944"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Feeds, through a small relay
              </p>
            </div>
            <div
              className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:945"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[14px]"
                data-node-id="19:946"
                data-name="Icon/plus"
              >
                <img alt="" className="figma-asset" src={imgIconPlus} />
              </div>
              <p
                className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
                data-node-id="19:947"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Fetches while a tab is open
              </p>
            </div>
            <div
              className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:948"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[14px]"
                data-node-id="19:949"
                data-name="Icon/plus"
              >
                <img alt="" className="figma-asset" src={imgIconPlus} />
              </div>
              <p
                className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
                data-node-id="19:950"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Newsletters as a feed address
              </p>
            </div>
            <div
              className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:951"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[14px]"
                data-node-id="19:952"
                data-name="Icon/x"
              >
                <img alt="" className="figma-asset" src={imgIconX} />
              </div>
              <p
                className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-muted)]"
                data-node-id="19:953"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Emailing your Brew
              </p>
            </div>
            <div
              className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:954"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[14px]"
                data-node-id="19:955"
                data-name="Icon/plus"
              >
                <img alt="" className="figma-asset" src={imgIconPlus} />
              </div>
              <p
                className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
                data-node-id="19:956"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Agents in this page only
              </p>
            </div>
          </div>
          <div
            className="h-[4px] relative shrink-0 w-[10px]"
            data-node-id="19:957"
            data-name="Frame"
          />
          <p
            className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[16px] min-w-full relative shrink-0 text-[12px] text-[color:var(--brew-text-muted)] w-[min-content]"
            data-node-id="19:958"
            style={{ fontVariationSettings: '"wdth" 100' }}
          >
            Ready in 10 seconds
          </p>
          <div
            className="bg-[var(--brew-text-primary)] content-stretch flex gap-[6px] h-[36px] items-center justify-center px-[14px] relative rounded-[8px] shrink-0 w-full"
            data-node-id="19:959"
            data-name="Button/Start here"
          >
            <p
              className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[13px] text-[color:var(--brew-text-inverse)] whitespace-nowrap"
              data-node-id="I19:959;6:6"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              Start here
            </p>
          </div>
        </div>
        <div
          className="bg-[var(--brew-bg-surface)] border border-[var(--brew-border-default)] border-solid content-stretch flex flex-col gap-[14px] h-[439px] items-start overflow-clip p-[20px] relative rounded-[14px] shrink-0 w-[256px]"
          data-node-id="19:960"
          data-name="Mode card · Your computer or server"
        >
          <div
            className="content-stretch flex items-center overflow-clip relative shrink-0 w-full"
            data-node-id="19:961"
            data-name="Frame"
          >
            <div
              className="bg-[var(--brew-bg-subtle)] content-stretch flex items-center justify-center overflow-clip relative rounded-[10px] shrink-0 size-[40px]"
              data-node-id="19:962"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[20px]"
                data-node-id="19:963"
                data-name="Icon/server"
              >
                <img alt="" className="figma-asset" src={imgIconServer} />
              </div>
            </div>
            <div
              className="flex-[1_0_0] h-px min-w-px relative"
              data-node-id="19:964"
              data-name="Spacer"
            />
            <Badge
              className="bg-[var(--brew-accent-soft)] content-stretch flex gap-[5px] h-[22px] items-center pl-[7px] pr-[8px] relative rounded-[999px] shrink-0"
              label="Most complete"
              tone="accent"
            />
          </div>
          <div
            className="[word-break:break-word] content-stretch flex flex-col gap-[6px] items-start overflow-clip relative shrink-0 w-full"
            data-node-id="19:966"
            data-name="Frame"
          >
            <p
              className="font-[family-name:var(--brew-font-ui)] font-semibold leading-[22px] relative shrink-0 text-[17px] text-[color:var(--brew-text-primary)] tracking-[-0.17px] w-full"
              data-node-id="19:967"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              Your computer or server
            </p>
            <p
              className="font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] relative shrink-0 text-[13px] text-[color:var(--brew-text-soft)] w-full"
              data-node-id="19:968"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              One Node process or a Docker container, one SQLite file.
            </p>
          </div>
          <div
            className="bg-[var(--brew-border-default)] h-px relative shrink-0 w-full"
            data-node-id="19:969"
            data-name="Rule"
          />
          <div
            className="content-stretch flex flex-col gap-[9px] items-start overflow-clip relative shrink-0 w-full"
            data-node-id="19:970"
            data-name="Capabilities"
          >
            <div
              className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:971"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[14px]"
                data-node-id="19:972"
                data-name="Icon/check"
              >
                <img alt="" className="figma-asset" src={imgIconCheck} />
              </div>
              <p
                className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
                data-node-id="19:973"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Feeds and full text
              </p>
            </div>
            <div
              className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:974"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[14px]"
                data-node-id="19:975"
                data-name="Icon/check"
              >
                <img alt="" className="figma-asset" src={imgIconCheck} />
              </div>
              <p
                className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
                data-node-id="19:976"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Fetches in the background
              </p>
            </div>
            <div
              className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:977"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[14px]"
                data-node-id="19:978"
                data-name="Icon/plus"
              >
                <img alt="" className="figma-asset" src={imgIconPlus} />
              </div>
              <p
                className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
                data-node-id="19:979"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Newsletters over IMAP or webhook
              </p>
            </div>
            <div
              className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:980"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[14px]"
                data-node-id="19:981"
                data-name="Icon/plus"
              >
                <img alt="" className="figma-asset" src={imgIconPlus} />
              </div>
              <p
                className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
                data-node-id="19:982"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Email through your SMTP
              </p>
            </div>
            <div
              className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:983"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[14px]"
                data-node-id="19:984"
                data-name="Icon/check"
              >
                <img alt="" className="figma-asset" src={imgIconCheck} />
              </div>
              <p
                className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
                data-node-id="19:985"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                MCP, Reeder, NetNewsWire
              </p>
            </div>
          </div>
          <div
            className="h-[4px] relative shrink-0 w-[10px]"
            data-node-id="19:986"
            data-name="Frame"
          />
          <p
            className="[word-break:break-word] font-[family-name:var(--brew-font-mono)] font-normal leading-[16px] min-w-full relative shrink-0 text-[12px] text-[color:var(--brew-text-primary)] w-[min-content]"
            data-node-id="19:987"
          >
            npx brew-reader
          </p>
          <div
            className="bg-[var(--brew-bg-surface)] border border-[var(--brew-border-strong)] border-solid content-stretch flex gap-[6px] h-[36px] items-center justify-center px-[14px] relative rounded-[8px] shrink-0 w-full"
            data-node-id="19:988"
            data-name="Button/Copy command"
          >
            <div
              className="relative shrink-0 size-[16px]"
              data-node-id="I19:988;6:12"
              data-name="Icon"
            >
              <img alt="" className="figma-asset" src={imgIcon} />
            </div>
            <p
              className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[13px] text-[color:var(--brew-text-primary)] whitespace-nowrap"
              data-node-id="I19:988;6:14"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              Copy command
            </p>
          </div>
        </div>
        <div
          className="bg-[var(--brew-bg-surface)] border border-[var(--brew-border-default)] border-solid content-stretch flex flex-col gap-[14px] h-[439px] items-start overflow-clip p-[20px] relative rounded-[14px] shrink-0 w-[256px]"
          data-node-id="19:989"
          data-name="Mode card · Cloudflare"
        >
          <div
            className="content-stretch flex items-center overflow-clip relative shrink-0 w-full"
            data-node-id="19:990"
            data-name="Frame"
          >
            <div
              className="bg-[var(--brew-bg-subtle)] content-stretch flex items-center justify-center overflow-clip relative rounded-[10px] shrink-0 size-[40px]"
              data-node-id="19:991"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[20px]"
                data-node-id="19:992"
                data-name="Icon/cloud"
              >
                <img alt="" className="figma-asset" src={imgIconCloud} />
              </div>
            </div>
            <div
              className="flex-[1_0_0] h-px min-w-px relative"
              data-node-id="19:993"
              data-name="Spacer"
            />
          </div>
          <div
            className="[word-break:break-word] content-stretch flex flex-col gap-[6px] items-start overflow-clip relative shrink-0 w-full"
            data-node-id="19:994"
            data-name="Frame"
          >
            <p
              className="font-[family-name:var(--brew-font-ui)] font-semibold leading-[22px] relative shrink-0 text-[17px] text-[color:var(--brew-text-primary)] tracking-[-0.17px] w-full"
              data-node-id="19:995"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              Cloudflare
            </p>
            <p
              className="font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] relative shrink-0 text-[13px] text-[color:var(--brew-text-soft)] w-full"
              data-node-id="19:996"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              Your own Worker and D1 database. Inbound mail built in.
            </p>
          </div>
          <div
            className="bg-[var(--brew-border-default)] h-px relative shrink-0 w-full"
            data-node-id="19:997"
            data-name="Rule"
          />
          <div
            className="content-stretch flex flex-col gap-[9px] items-start overflow-clip relative shrink-0 w-full"
            data-node-id="19:998"
            data-name="Capabilities"
          >
            <div
              className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:999"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[14px]"
                data-node-id="19:1000"
                data-name="Icon/check"
              >
                <img alt="" className="figma-asset" src={imgIconCheck} />
              </div>
              <p
                className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
                data-node-id="19:1001"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Feeds and full text
              </p>
            </div>
            <div
              className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:1002"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[14px]"
                data-node-id="19:1003"
                data-name="Icon/check"
              >
                <img alt="" className="figma-asset" src={imgIconCheck} />
              </div>
              <p
                className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
                data-node-id="19:1004"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Fetches every 15 minutes
              </p>
            </div>
            <div
              className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:1005"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[14px]"
                data-node-id="19:1006"
                data-name="Icon/check"
              >
                <img alt="" className="figma-asset" src={imgIconCheck} />
              </div>
              <p
                className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
                data-node-id="19:1007"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Newsletters, natively
              </p>
            </div>
            <div
              className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:1008"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[14px]"
                data-node-id="19:1009"
                data-name="Icon/plus"
              >
                <img alt="" className="figma-asset" src={imgIconPlus} />
              </div>
              <p
                className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
                data-node-id="19:1010"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Email with a mail binding
              </p>
            </div>
            <div
              className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:1011"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[14px]"
                data-node-id="19:1012"
                data-name="Icon/check"
              >
                <img alt="" className="figma-asset" src={imgIconCheck} />
              </div>
              <p
                className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
                data-node-id="19:1013"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                MCP, Reeder, NetNewsWire
              </p>
            </div>
          </div>
          <div
            className="h-[4px] relative shrink-0 w-[10px]"
            data-node-id="19:1014"
            data-name="Frame"
          />
          <p
            className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[16px] min-w-full relative shrink-0 text-[12px] text-[color:var(--brew-text-muted)] w-[min-content]"
            data-node-id="19:1015"
            style={{ fontVariationSettings: '"wdth" 100' }}
          >
            Free tier fits ~40 feeds a run
          </p>
          <div
            className="bg-[var(--brew-bg-surface)] border border-[var(--brew-border-strong)] border-solid content-stretch flex gap-[6px] h-[36px] items-center justify-center px-[14px] relative rounded-[8px] shrink-0 w-full"
            data-node-id="19:1016"
            data-name="Button/Deploy to Cloudflare"
          >
            <div
              className="relative shrink-0 size-[16px]"
              data-node-id="I19:1016;6:12"
              data-name="Icon"
            >
              <img alt="" className="figma-asset" src={imgIcon1} />
            </div>
            <p
              className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[13px] text-[color:var(--brew-text-primary)] whitespace-nowrap"
              data-node-id="I19:1016;6:14"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              Deploy to Cloudflare
            </p>
          </div>
        </div>
        <div
          className="bg-[var(--brew-bg-surface)] border border-[var(--brew-border-default)] border-solid content-stretch flex flex-col gap-[14px] h-[439px] items-start overflow-clip p-[20px] relative rounded-[14px] shrink-0 w-[256px]"
          data-node-id="19:1017"
          data-name="Mode card · Shared hosting"
        >
          <div
            className="content-stretch flex items-center overflow-clip relative shrink-0 w-full"
            data-node-id="19:1018"
            data-name="Frame"
          >
            <div
              className="bg-[var(--brew-bg-subtle)] content-stretch flex items-center justify-center overflow-clip relative rounded-[10px] shrink-0 size-[40px]"
              data-node-id="19:1019"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[20px]"
                data-node-id="19:1020"
                data-name="Icon/globe"
              >
                <img alt="" className="figma-asset" src={imgIconGlobe} />
              </div>
            </div>
            <div
              className="flex-[1_0_0] h-px min-w-px relative"
              data-node-id="19:1021"
              data-name="Spacer"
            />
            <Badge
              className="bg-[var(--brew-bg-subtle)] content-stretch flex gap-[5px] h-[22px] items-center pl-[7px] pr-[8px] relative rounded-[999px] shrink-0"
              label="Lite"
            />
          </div>
          <div
            className="[word-break:break-word] content-stretch flex flex-col gap-[6px] items-start overflow-clip relative shrink-0 w-full"
            data-node-id="19:1023"
            data-name="Frame"
          >
            <p
              className="font-[family-name:var(--brew-font-ui)] font-semibold leading-[22px] relative shrink-0 text-[17px] text-[color:var(--brew-text-primary)] tracking-[-0.17px] w-full"
              data-node-id="19:1024"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              Shared hosting
            </p>
            <p
              className="font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] relative shrink-0 text-[13px] text-[color:var(--brew-text-soft)] w-full"
              data-node-id="19:1025"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              Upload a folder to any PHP host with cron.
            </p>
          </div>
          <div
            className="bg-[var(--brew-border-default)] h-px relative shrink-0 w-full"
            data-node-id="19:1026"
            data-name="Rule"
          />
          <div
            className="content-stretch flex flex-col gap-[9px] items-start overflow-clip relative shrink-0 w-full"
            data-node-id="19:1027"
            data-name="Capabilities"
          >
            <div
              className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:1028"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[14px]"
                data-node-id="19:1029"
                data-name="Icon/check"
              >
                <img alt="" className="figma-asset" src={imgIconCheck} />
              </div>
              <p
                className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
                data-node-id="19:1030"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Feeds and full text
              </p>
            </div>
            <div
              className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:1031"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[14px]"
                data-node-id="19:1032"
                data-name="Icon/check"
              >
                <img alt="" className="figma-asset" src={imgIconCheck} />
              </div>
              <p
                className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
                data-node-id="19:1033"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Fetches on your host’s cron
              </p>
            </div>
            <div
              className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:1034"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[14px]"
                data-node-id="19:1035"
                data-name="Icon/plus"
              >
                <img alt="" className="figma-asset" src={imgIconPlus} />
              </div>
              <p
                className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
                data-node-id="19:1036"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Newsletters over IMAP
              </p>
            </div>
            <div
              className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:1037"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[14px]"
                data-node-id="19:1038"
                data-name="Icon/check"
              >
                <img alt="" className="figma-asset" src={imgIconCheck} />
              </div>
              <p
                className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
                data-node-id="19:1039"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Email through PHP mail
              </p>
            </div>
            <div
              className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:1040"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[14px]"
                data-node-id="19:1041"
                data-name="Icon/plus"
              >
                <img alt="" className="figma-asset" src={imgIconPlus} />
              </div>
              <p
                className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
                data-node-id="19:1042"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Reeder and NetNewsWire
              </p>
            </div>
          </div>
          <div
            className="h-[4px] relative shrink-0 w-[10px]"
            data-node-id="19:1043"
            data-name="Frame"
          />
          <p
            className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[16px] min-w-full relative shrink-0 text-[12px] text-[color:var(--brew-text-muted)] w-[min-content]"
            data-node-id="19:1044"
            style={{ fontVariationSettings: '"wdth" 100' }}
          >
            Rules run in your browser
          </p>
          <div
            className="bg-[var(--brew-bg-surface)] border border-[var(--brew-border-strong)] border-solid content-stretch flex gap-[6px] h-[36px] items-center justify-center px-[14px] relative rounded-[8px] shrink-0 w-full"
            data-node-id="19:1045"
            data-name="Button/Download Lite"
          >
            <div
              className="relative shrink-0 size-[16px]"
              data-node-id="I19:1045;6:12"
              data-name="Icon"
            >
              <img alt="" className="figma-asset" src={imgIcon2} />
            </div>
            <p
              className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[13px] text-[color:var(--brew-text-primary)] whitespace-nowrap"
              data-node-id="I19:1045;6:14"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              Download Lite
            </p>
          </div>
        </div>
        <div
          className="bg-[var(--brew-bg-surface)] border border-[var(--brew-border-default)] border-solid content-stretch flex flex-col gap-[14px] h-[439px] items-start overflow-clip p-[20px] relative rounded-[14px] shrink-0 w-[256px]"
          data-node-id="19:1046"
          data-name="Mode card · GitHub Pages"
        >
          <div
            className="content-stretch flex items-center overflow-clip relative shrink-0 w-full"
            data-node-id="19:1047"
            data-name="Frame"
          >
            <div
              className="bg-[var(--brew-bg-subtle)] content-stretch flex items-center justify-center overflow-clip relative rounded-[10px] shrink-0 size-[40px]"
              data-node-id="19:1048"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[20px]"
                data-node-id="19:1049"
                data-name="Icon/file"
              >
                <img alt="" className="figma-asset" src={imgIconFile} />
              </div>
            </div>
            <div
              className="flex-[1_0_0] h-px min-w-px relative"
              data-node-id="19:1050"
              data-name="Spacer"
            />
            <Badge
              className="bg-[var(--brew-bg-subtle)] content-stretch flex gap-[5px] h-[22px] items-center pl-[7px] pr-[8px] relative rounded-[999px] shrink-0"
              label="Read-only"
            />
          </div>
          <div
            className="[word-break:break-word] content-stretch flex flex-col gap-[6px] items-start overflow-clip relative shrink-0 w-full"
            data-node-id="19:1052"
            data-name="Frame"
          >
            <p
              className="font-[family-name:var(--brew-font-ui)] font-semibold leading-[22px] relative shrink-0 text-[17px] text-[color:var(--brew-text-primary)] tracking-[-0.17px] w-full"
              data-node-id="19:1053"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              GitHub Pages
            </p>
            <p
              className="font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] relative shrink-0 text-[13px] text-[color:var(--brew-text-soft)] w-full"
              data-node-id="19:1054"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              A public, read-only Brew rebuilt by GitHub Actions.
            </p>
          </div>
          <div
            className="bg-[var(--brew-border-default)] h-px relative shrink-0 w-full"
            data-node-id="19:1055"
            data-name="Rule"
          />
          <div
            className="content-stretch flex flex-col gap-[9px] items-start overflow-clip relative shrink-0 w-full"
            data-node-id="19:1056"
            data-name="Capabilities"
          >
            <div
              className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:1057"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[14px]"
                data-node-id="19:1058"
                data-name="Icon/check"
              >
                <img alt="" className="figma-asset" src={imgIconCheck} />
              </div>
              <p
                className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
                data-node-id="19:1059"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Feeds, at build time
              </p>
            </div>
            <div
              className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:1060"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[14px]"
                data-node-id="19:1061"
                data-name="Icon/plus"
              >
                <img alt="" className="figma-asset" src={imgIconPlus} />
              </div>
              <p
                className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
                data-node-id="19:1062"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Rebuilds on a schedule
              </p>
            </div>
            <div
              className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:1063"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[14px]"
                data-node-id="19:1064"
                data-name="Icon/plus"
              >
                <img alt="" className="figma-asset" src={imgIconPlus} />
              </div>
              <p
                className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
                data-node-id="19:1065"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Newsletters as a feed address
              </p>
            </div>
            <div
              className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:1066"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[14px]"
                data-node-id="19:1067"
                data-name="Icon/x"
              >
                <img alt="" className="figma-asset" src={imgIconX} />
              </div>
              <p
                className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-muted)]"
                data-node-id="19:1068"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Emailing your Brew
              </p>
            </div>
            <div
              className="content-stretch flex gap-[8px] items-center overflow-clip relative shrink-0 w-full"
              data-node-id="19:1069"
              data-name="Frame"
            >
              <div
                className="relative shrink-0 size-[14px]"
                data-node-id="19:1070"
                data-name="Icon/plus"
              >
                <img alt="" className="figma-asset" src={imgIconPlus} />
              </div>
              <p
                className="[word-break:break-word] flex-[1_0_0] font-[family-name:var(--brew-font-ui)] font-normal leading-[19px] min-w-px relative text-[13px] text-[color:var(--brew-text-primary)]"
                data-node-id="19:1071"
                style={{ fontVariationSettings: '"wdth" 100' }}
              >
                Agents read llms.txt + JSON
              </p>
            </div>
          </div>
          <div
            className="h-[4px] relative shrink-0 w-[10px]"
            data-node-id="19:1072"
            data-name="Frame"
          />
          <p
            className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[16px] min-w-full relative shrink-0 text-[12px] text-[color:var(--brew-text-muted)] w-[min-content]"
            data-node-id="19:1073"
            style={{ fontVariationSettings: '"wdth" 100' }}
          >
            Good for sharing a reading list
          </p>
          <div
            className="bg-[var(--brew-bg-surface)] border border-[var(--brew-border-strong)] border-solid content-stretch flex gap-[6px] h-[36px] items-center justify-center px-[14px] relative rounded-[8px] shrink-0 w-full"
            data-node-id="19:1074"
            data-name="Button/Use template"
          >
            <div
              className="relative shrink-0 size-[16px]"
              data-node-id="I19:1074;6:12"
              data-name="Icon"
            >
              <img alt="" className="figma-asset" src={imgIcon3} />
            </div>
            <p
              className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-medium leading-[16px] relative shrink-0 text-[13px] text-[color:var(--brew-text-primary)] whitespace-nowrap"
              data-node-id="I19:1074;6:14"
              style={{ fontVariationSettings: '"wdth" 100' }}
            >
              Use template
            </p>
          </div>
        </div>
      </div>
      <div className="h-[24px] relative shrink-0 w-[10px]" data-node-id="19:1075" data-name="Gap" />
      <div
        className="content-stretch flex gap-[20px] items-center overflow-clip relative shrink-0"
        data-node-id="19:1132"
        data-name="Legend"
      >
        <div
          className="content-stretch flex gap-[6px] items-center overflow-clip relative shrink-0"
          data-node-id="19:1133"
          data-name="Frame"
        >
          <div
            className="relative shrink-0 size-[13px]"
            data-node-id="19:1134"
            data-name="Icon/check"
          >
            <img alt="" className="figma-asset" src={imgIconCheck1} />
          </div>
          <p
            className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[16px] relative shrink-0 text-[12px] text-[color:var(--brew-text-soft)] whitespace-nowrap"
            data-node-id="19:1135"
            style={{ fontVariationSettings: '"wdth" 100' }}
          >
            Works
          </p>
        </div>
        <div
          className="content-stretch flex gap-[6px] items-center overflow-clip relative shrink-0"
          data-node-id="19:1136"
          data-name="Frame"
        >
          <div
            className="relative shrink-0 size-[13px]"
            data-node-id="19:1137"
            data-name="Icon/plus"
          >
            <img alt="" className="figma-asset" src={imgIconPlus1} />
          </div>
          <p
            className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[16px] relative shrink-0 text-[12px] text-[color:var(--brew-text-soft)] whitespace-nowrap"
            data-node-id="19:1138"
            style={{ fontVariationSettings: '"wdth" 100' }}
          >
            Works with an add-on
          </p>
        </div>
        <div
          className="content-stretch flex gap-[6px] items-center overflow-clip relative shrink-0"
          data-node-id="19:1139"
          data-name="Frame"
        >
          <div className="relative shrink-0 size-[13px]" data-node-id="19:1140" data-name="Icon/x">
            <img alt="" className="figma-asset" src={imgIconX1} />
          </div>
          <p
            className="[word-break:break-word] font-[family-name:var(--brew-font-ui)] font-normal leading-[16px] relative shrink-0 text-[12px] text-[color:var(--brew-text-soft)] whitespace-nowrap"
            data-node-id="19:1141"
            style={{ fontVariationSettings: '"wdth" 100' }}
          >
            Not available here
          </p>
        </div>
      </div>
    </div>
  );
}
