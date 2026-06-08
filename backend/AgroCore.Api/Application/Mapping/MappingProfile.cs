using AgroCore.Application.DTOs;
using AgroCore.Domain.Entities;
using AutoMapper;

namespace AgroCore.Application.Mapping;

/// <summary>
/// Perfil AutoMapper centralizado. Los servicios igual prefieren mapeo manual
/// cuando necesitan joins o filas calculadas, pero este perfil sirve para DTOs simples.
/// </summary>
public class MappingProfile : Profile
{
    public MappingProfile()
    {
        // Seguridad ------------------------------------------------------------
        CreateMap<Usuario, UsuarioResumen>()
            .ConstructUsing(u => new UsuarioResumen(u.UsuarioId, u.Username, u.NombreCompleto, u.Email));

        CreateMap<Empresa, EmpresaResumen>()
            .ConstructUsing(e => new EmpresaResumen(e.EmpresaId, e.RazonSocial, e.Cuit, e.EsPyme, e.CondicionIva));

        // Campo / Lote ---------------------------------------------------------
        CreateMap<Campo, CampoDto>()
            .ConstructUsing(c => new CampoDto(c.CampoId, c.Codigo, c.Nombre, c.SuperficieTotalHa,
                c.Localidad, c.Provincia, c.Renspa, c.Propio, c.Activo));

        // Insumos / compras ---------------------------------------------------
        CreateMap<Insumo, InsumoDto>()
            .ConstructUsing(i => new InsumoDto(i.InsumoId, i.Codigo, i.Nombre, i.TipoInsumo,
                i.UnidadMedida, i.StockActual, i.StockMinimo, i.CostoPromedio, i.MonedaCostoId, i.Activo));

        // Hacienda ------------------------------------------------------------
        CreateMap<Hacienda, HaciendaDto>()
            .ConstructUsing(h => new HaciendaDto(h.HaciendaId, h.CaravanaSenasa, h.Categoria,
                h.Raza, h.PesoActualKg, h.Estado));

        // Viajes --------------------------------------------------------------
        CreateMap<ViajeCamion, ViajeCamionDto>()
            .ConstructUsing(v => new ViajeCamionDto(v.ViajeCamionId, v.Fecha, v.NumeroCartaPorte,
                v.DominioTractor, v.ChoferNombre, v.TransportistaRazonSocial,
                v.ClienteId, null, v.CultivoId, null, v.KgOrigen, v.KgDestino, v.Merma, v.Estado));

        // Empleados -----------------------------------------------------------
        CreateMap<Empleado, EmpleadoDto>()
            .ConstructUsing(e => new EmpleadoDto(e.EmpleadoId, e.Legajo, e.Apellido, e.Nombre,
                e.Puesto, e.SueldoBasico, e.MonedaId, e.Activo));
    }
}
