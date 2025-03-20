import { Modding, OnInit, OnStart, Service } from "@flamework/core";
import { QuarrelCommands } from "@quarrelgame-framework/common";
import { Cmdr } from "@rbxts/cmdr";

interface OnCmdrLoaded
{
    onCmdrLoaded(): void;
}

@Service({})
export class CommandService
{
    private onCmdrLoadedHandler: Set<OnCmdrLoaded> = new Set();

    protected _script?: LuaSourceContainer;
    public Register(_script: LuaSourceContainer)
    {
        if (this._script)

            return error("already registered");

        this._script = _script;

        Modding.onListenerAdded<OnCmdrLoaded>((l) => this.onCmdrLoadedHandler.add(l));
        Modding.onListenerRemoved<OnCmdrLoaded>((l) => this.onCmdrLoadedHandler.delete(l));

        const commandHandlers = this._script.WaitForChild("handler").GetChildren() as ModuleScript[];
        let failedCommand: Instances[keyof Omit<Instances, "ModuleScript">];
        assert(commandHandlers.every((c) => (!c.IsA("ModuleScript") ? !!(failedCommand = c) : true)), `instance ${failedCommand!} is not a module script`);

        for (const command of commandHandlers)
            Cmdr.RegisterCommand(QuarrelCommands[command.Name.gsub("handler", "command") as never], command);

        Cmdr.RegisterHooksIn(this._script.WaitForChild("hook"));
    }
}

export default CommandService
