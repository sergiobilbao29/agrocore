using AgroCore.Application.DTOs;
using FluentValidation;

namespace AgroCore.Application.Validators;

public class LoginRequestValidator : AbstractValidator<LoginRequest>
{
    public LoginRequestValidator()
    {
        RuleFor(x => x.UsernameOrEmail).NotEmpty().MaximumLength(120);
        RuleFor(x => x.Password).NotEmpty().MinimumLength(6);
    }
}

public class ChangePasswordValidator : AbstractValidator<ChangePasswordRequest>
{
    public ChangePasswordValidator()
    {
        RuleFor(x => x.PasswordActual).NotEmpty();
        RuleFor(x => x.PasswordNueva).NotEmpty().MinimumLength(8)
            .Matches(@"[A-Z]").WithMessage("Debe contener al menos una mayúscula.")
            .Matches(@"\d").WithMessage("Debe contener al menos un dígito.");
    }
}

public class CrearUsuarioValidator : AbstractValidator<CrearUsuarioRequest>
{
    public CrearUsuarioValidator()
    {
        RuleFor(x => x.Username).NotEmpty().MaximumLength(60);
        RuleFor(x => x.Email).NotEmpty().EmailAddress();
        RuleFor(x => x.NombreCompleto).NotEmpty().MaximumLength(120);
        RuleFor(x => x.Password).NotEmpty().MinimumLength(8);
    }
}

public class CampoCreateValidator : AbstractValidator<CampoCreateDto>
{
    public CampoCreateValidator()
    {
        RuleFor(x => x.Codigo).NotEmpty().MaximumLength(20);
        RuleFor(x => x.Nombre).NotEmpty().MaximumLength(120);
        RuleFor(x => x.SuperficieTotalHa).GreaterThan(0);
    }
}

public class LoteCreateValidator : AbstractValidator<LoteCreateDto>
{
    public LoteCreateValidator()
    {
        RuleFor(x => x.CampoId).GreaterThan(0);
        RuleFor(x => x.Codigo).NotEmpty();
        RuleFor(x => x.Nombre).NotEmpty();
        RuleFor(x => x.SuperficieHa).GreaterThan(0);
    }
}

public class CampanaCreateValidator : AbstractValidator<CampanaCreateDto>
{
    public CampanaCreateValidator()
    {
        RuleFor(x => x.LoteId).GreaterThan(0);
        RuleFor(x => x.CultivoId).GreaterThan(0);
        RuleFor(x => x.Nombre).NotEmpty();
        RuleFor(x => x.SuperficieSembradaHa).GreaterThan(0);
    }
}

public class InsumoCreateValidator : AbstractValidator<InsumoCreateDto>
{
    public InsumoCreateValidator()
    {
        RuleFor(x => x.Codigo).NotEmpty();
        RuleFor(x => x.Nombre).NotEmpty();
        RuleFor(x => x.TipoInsumo).NotEmpty();
        RuleFor(x => x.UnidadMedida).NotEmpty();
        RuleFor(x => x.StockMinimo).GreaterThanOrEqualTo(0);
    }
}

public class OrdenTrabajoCreateValidator : AbstractValidator<OrdenTrabajoCreateDto>
{
    public OrdenTrabajoCreateValidator()
    {
        RuleFor(x => x.LoteId).GreaterThan(0);
        RuleFor(x => x.TipoLabor).NotEmpty();
        RuleFor(x => x.SuperficieHa).GreaterThan(0);
        RuleForEach(x => x.Insumos).ChildRules(i =>
        {
            i.RuleFor(d => d.InsumoId).GreaterThan(0);
            i.RuleFor(d => d.PlanCantidad).GreaterThan(0);
        });
    }
}

public class OrdenTrabajoEjecutarValidator : AbstractValidator<OrdenTrabajoEjecutarDto>
{
    public OrdenTrabajoEjecutarValidator()
    {
        RuleFor(x => x.FechaInicio).NotEmpty();
        RuleForEach(x => x.InsumosReales).ChildRules(i =>
        {
            i.RuleFor(d => d.OrdenTrabajoInsumoId).GreaterThan(0);
            i.RuleFor(d => d.RealCantidad).GreaterThanOrEqualTo(0);
        });
    }
}

public class CompraInsumoCreateValidator : AbstractValidator<CompraInsumoCreateDto>
{
    public CompraInsumoCreateValidator()
    {
        RuleFor(x => x.ProveedorId).GreaterThan(0);
        RuleFor(x => x.Fecha).NotEmpty();
        RuleFor(x => x.Detalles).NotEmpty().WithMessage("Debe incluir al menos un ítem.");
        RuleForEach(x => x.Detalles).ChildRules(d =>
        {
            d.RuleFor(x => x.InsumoId).GreaterThan(0);
            d.RuleFor(x => x.Cantidad).GreaterThan(0);
            d.RuleFor(x => x.PrecioUnitario).GreaterThanOrEqualTo(0);
        });
    }
}

public class MovimientoCajaCreateValidator : AbstractValidator<MovimientoCajaCreateDto>
{
    public MovimientoCajaCreateValidator()
    {
        RuleFor(x => x.Fecha).NotEmpty();
        RuleFor(x => x.Tipo).NotEmpty().Must(t => t is "Ingreso" or "Egreso" or "Transferencia")
            .WithMessage("Tipo debe ser Ingreso | Egreso | Transferencia.");
        RuleFor(x => x.Importe).GreaterThan(0);
    }
}

public class ChequeCreateValidator : AbstractValidator<ChequeCreateDto>
{
    public ChequeCreateValidator()
    {
        RuleFor(x => x.Tipo).NotEmpty().Must(t => t is "Propio" or "Tercero");
        RuleFor(x => x.Numero).NotEmpty();
        RuleFor(x => x.Importe).GreaterThan(0);
        RuleFor(x => x.FechaVencimiento).GreaterThanOrEqualTo(x => x.FechaEmision);
    }
}

public class VentaGranoCreateValidator : AbstractValidator<VentaGranoCreateDto>
{
    public VentaGranoCreateValidator()
    {
        RuleFor(x => x.ClienteId).GreaterThan(0);
        RuleFor(x => x.CultivoId).GreaterThan(0);
        RuleFor(x => x.Kilogramos).GreaterThan(0);
        RuleFor(x => x.PrecioUnitarioPorTn).GreaterThan(0);
    }
}
